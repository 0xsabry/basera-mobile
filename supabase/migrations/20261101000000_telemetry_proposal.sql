-- =====================================================================
-- PROPOSAL v5 — NOT APPLIED TO PRODUCTION. DO NOT RUN without the
-- owner's explicit approval after final review (owner rule: no
-- production migration before it is shown to him and approved).
--
-- BASERA installations & OTA adoption telemetry.
-- Project: vbvvwyeccsegfwprwrga (the existing project — no new project).
-- This migration is ADDITIVE ONLY: new schema objects, nothing that
-- exists in production is altered or dropped.
--
-- v5 changes (owner client review round):
--   * Installation identity is SERVER-ISSUED: the app ships no
--     CSPRNG (expo-crypto is absent from APK 1.1.8 and no native
--     dependency may be added for this), so a new function
--     public.telemetry_bootstrap() generates the installation id
--     and secret with the server's CSPRNG (gen_random_uuid) and
--     returns the secret exactly once; only its SHA-256 is stored.
--     telemetry_ingest no longer self-registers unknown ids — it
--     refuses them (unknown_installation). Bootstrap also hands out
--     a pool of server-generated event ids, so the client never
--     mints a security-relevant identifier with Math.random.
--   * app_installations.is_embedded_launch is NULLABLE: an absent
--     fact stays unknown (null) instead of being coerced to a
--     boolean; a present non-boolean fact is rejected upstream.
--
-- v4 changes (owner final review round):
--   * A DEDICATED schema `basera_telemetry_private` holds the
--     dashboard logic (the generic name `private` is not used, and no
--     privileges of any pre-existing schema are touched). The schema
--     is never added to the Data API's exposed schemas, so its
--     functions are unreachable over REST regardless of SQL grants.
--   * The public RPC wrappers are SECURITY INVOKER pass-throughs:
--     they hold no elevated privileges of their own. The private
--     implementations remain SECURITY DEFINER (they must read tables
--     that no client role may touch) and each one re-checks the
--     owner allowlist; EXECUTE on them is granted to authenticated
--     only, so even a direct SQL call by a non-owner is refused by
--     the gate inside.
--   * telemetry_ingest stays in public on purpose: the Edge Function
--     reaches it through PostgREST rpc, which only resolves functions
--     in exposed schemas. It is SECURITY DEFINER with EXECUTE granted
--     to service_role ONLY — no client role can call it.
--   * Strict ingest: p_events must be a JSON array of at most 50
--     object elements, with strict per-field JSON types (a numeric
--     or boolean failure_reason is rejected, never coerced). A
--     malformed request fails BEFORE any write — no registration and
--     no heartbeat is recorded for it.
--   * A global registration circuit breaker (500 new installations
--     per hour, serialized by a dedicated advisory lock) bounds
--     scripted fake-install floods; existing installations are never
--     affected by it.
--   * v_recent is bigint.
--
-- Security summary:
--   * Every SECURITY DEFINER function uses SET search_path = '' and
--     fully schema-qualified object names.
--   * RLS enabled on all tables with NO client policies, and all
--     privileges revoked from anon/authenticated: direct table reads
--     from any client are impossible.
--   * No personal data: no user ids, no location, no hardware
--     identifiers. Installations are anonymous random UUIDs.
--
-- Owner registration (after applying, run once with the owner's
-- CONFIRMED Supabase Auth user id — Dashboard > Authentication > Users):
--   insert into public.dashboard_owners (user_id)
--   values ('<OWNER_AUTH_UID>');
--
-- Measurement trust limits (documented, not hidden): counts are
-- trustworthy for honest, unmodified clients. A device owner running
-- a modified/rooted build could forge events for their OWN
-- installation id (bound to their secret) or register extra fake
-- installations (bounded by the circuit breaker); the system is not
-- — and does not claim to be — tamper-proof against the owner of a
-- modified device. Adoption ratios between funnel stages are the
-- robust signal.
-- =====================================================================

create schema if not exists basera_telemetry_private;
-- A fresh schema grants nothing to PUBLIC by default; revoke anyway
-- so the posture is explicit, then grant the single narrow right the
-- design needs: authenticated may RESOLVE the private functions (the
-- owner gate inside still decides). anon gets nothing.
revoke all on schema basera_telemetry_private from public, anon, authenticated;
grant usage on schema basera_telemetry_private to authenticated;

create table if not exists public.app_installations (
  id uuid primary key,
  secret_hash text not null,
  platform text not null default 'android',
  os_version text,
  app_version text,
  version_code integer,
  runtime_version text,
  channel text,
  current_update_id text,
  is_embedded_launch boolean,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.app_update_events (
  id bigint generated always as identity primary key,
  client_event_id uuid not null unique,
  installation_id uuid not null references public.app_installations (id) on delete cascade,
  event_type text not null check (event_type in
    ('update_check', 'update_available', 'update_downloaded', 'update_applied', 'update_failed')),
  update_id text,
  app_version text,
  runtime_version text,
  channel text,
  status text not null default 'ok' check (status in ('ok', 'failed')),
  failure_reason text,
  client_ts timestamptz,
  received_at timestamptz not null default now()
);
create index if not exists app_update_events_installation_idx
  on public.app_update_events (installation_id, received_at desc);
create index if not exists app_update_events_update_idx
  on public.app_update_events (update_id, event_type);
create index if not exists app_installations_last_seen_idx
  on public.app_installations (last_seen_at desc);
create index if not exists app_installations_version_idx
  on public.app_installations (app_version, version_code);
create index if not exists app_installations_first_seen_idx
  on public.app_installations (first_seen_at desc);

create table if not exists public.dashboard_owners (
  user_id uuid primary key
);

alter table public.app_installations enable row level security;
alter table public.app_update_events enable row level security;
alter table public.dashboard_owners enable row level security;
-- No policies on purpose: direct table access is denied to every
-- client role. The service role (Edge Function / ingest function)
-- bypasses RLS.

revoke all on public.app_installations, public.app_update_events, public.dashboard_owners
  from anon, authenticated;

-- =====================================================================
-- INGEST — the only write path. One transaction per request:
--   strict envelope checks -> per-installation advisory lock ->
--   pin-or-verify secret (new registrations additionally pass a
--   global circuit breaker under a registration lock) -> classify
--   events (invalid / duplicate / new) -> atomic budget -> insert ->
--   heartbeat. A malformed envelope returns an error BEFORE any
--   write: no registration, no heartbeat.
-- =====================================================================
create or replace function public.telemetry_ingest(
  p_installation_id uuid,
  p_secret_hash text,
  p_platform text,
  p_os_version text,
  p_app_version text,
  p_version_code integer,
  p_runtime_version text,
  p_channel text,
  p_current_update_id text,
  p_is_embedded_launch boolean,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inst public.app_installations%rowtype;
  v_found boolean := false;
  v_recent bigint;
  v_accepted jsonb := '[]'::jsonb;
  v_duplicates jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_ev jsonb;
  v_cid text;
  v_cid_uuid uuid;
  v_type text;
  v_uid text;
  v_status text;
  v_reason text;
  v_ts text;
  v_ts_parsed timestamptz;
  v_err text;
  v_field text;
  v_budget bigint := 600;
  v_new_count integer := 0;
begin
  if p_installation_id is null or p_secret_hash is null or length(p_secret_hash) <> 64 then
    return pg_catalog.jsonb_build_object('error', 'invalid_installation_credentials');
  end if;

  -- Strict envelope: events must be present, a JSON array, and hold
  -- at most 50 entries. Anything else fails the WHOLE request before
  -- any write (defense in depth behind the Edge Function's checks).
  if p_events is null or pg_catalog.jsonb_typeof(p_events) <> 'array' then
    return pg_catalog.jsonb_build_object('error', 'invalid_events');
  end if;
  if pg_catalog.jsonb_array_length(p_events) > 50 then
    return pg_catalog.jsonb_build_object('error', 'batch_too_large');
  end if;

  -- Serialize everything for this installation: first-registration
  -- secret pinning and the hourly budget are race-free under this lock.
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 0));

  select * into v_inst from public.app_installations i where i.id = p_installation_id;
  v_found := found;

  if not v_found then
    -- Installations are created ONLY by telemetry_bootstrap (server
    -- CSPRNG). An unknown id here was never issued: refuse it. No
    -- row is created and no heartbeat is recorded.
    return pg_catalog.jsonb_build_object('error', 'unknown_installation');
  elsif v_inst.secret_hash <> p_secret_hash then
    return pg_catalog.jsonb_build_object('error', 'secret_mismatch');
  end if;

  -- Events received in the trailing hour (budget base). Duplicates
  -- and invalid events below never add to this count.
  select count(*) into v_recent
  from public.app_update_events e
  where e.installation_id = p_installation_id
    and e.received_at > now() - interval '1 hour';

  for v_ev in select value from pg_catalog.jsonb_array_elements(p_events)
  loop
    v_err := null;
    v_field := null;

    if pg_catalog.jsonb_typeof(v_ev) <> 'object' then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object(
        'client_event_id', null, 'reason', 'invalid_event_shape');
      continue;
    end if;

    -- Strict JSON types per field: a present field must be a JSON
    -- string (or null). Numbers/booleans/objects are rejected with
    -- the field named — never silently coerced through ->>.
    foreach v_field in array array['client_event_id', 'event_type', 'update_id', 'status', 'failure_reason', 'client_ts']
    loop
      if v_ev ? v_field
         and pg_catalog.jsonb_typeof(v_ev -> v_field) not in ('string', 'null') then
        v_err := 'invalid_field_type';
        exit;
      end if;
    end loop;
    if v_err is null then
      v_field := null; -- only report a field when it is the offender
    end if;

    if v_err is null then
      v_cid := v_ev ->> 'client_event_id';
      v_type := v_ev ->> 'event_type';
      v_uid := v_ev ->> 'update_id';
      v_status := coalesce(v_ev ->> 'status', 'ok');
      v_reason := v_ev ->> 'failure_reason';
      v_ts := v_ev ->> 'client_ts';
      v_cid_uuid := null;
      v_ts_parsed := null;

      if v_cid is null then
        v_err := 'missing_client_event_id';
      else
        begin
          v_cid_uuid := v_cid::uuid;
        exception when others then
          v_err := 'invalid_client_event_id';
        end;
      end if;
      if v_err is null and (v_type is null or v_type not in
          ('update_check', 'update_available', 'update_downloaded', 'update_applied', 'update_failed')) then
        v_err := 'invalid_event_type';
      end if;
      if v_err is null and v_uid is not null
         and v_uid <> 'rollback-to-embedded'
         and v_uid !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
        v_err := 'invalid_update_id';
      end if;
      if v_err is null and v_status not in ('ok', 'failed') then
        v_err := 'invalid_status';
      end if;
      if v_err is null and v_reason is not null and length(v_reason) > 300 then
        v_err := 'failure_reason_too_long';
      end if;
      if v_err is null and v_ts is not null then
        begin
          v_ts_parsed := v_ts::timestamptz;
        exception when others then
          v_err := 'invalid_client_ts';
        end;
        if v_err is null and (v_ts_parsed < now() - interval '24 hours'
                              or v_ts_parsed > now() + interval '24 hours') then
          v_err := 'client_ts_out_of_window';
        end if;
      end if;
    end if;

    if v_err is not null then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object(
        'client_event_id', v_ev ->> 'client_event_id',
        'reason', v_err,
        'field', v_field);
      continue;
    end if;

    -- Duplicate? (Already stored — a retry/replay. Never counted
    -- against the budget, never inserted twice.)
    if exists (select 1 from public.app_update_events e where e.client_event_id = v_cid_uuid) then
      v_duplicates := v_duplicates || pg_catalog.to_jsonb(v_cid);
      continue;
    end if;

    -- Atomic budget for genuinely new events.
    if v_recent + v_new_count >= v_budget then
      v_rejected := v_rejected || pg_catalog.jsonb_build_object(
        'client_event_id', v_cid, 'reason', 'rate_limited');
      continue;
    end if;

    insert into public.app_update_events (
      client_event_id, installation_id, event_type, update_id,
      app_version, runtime_version, channel, status, failure_reason, client_ts
    ) values (
      v_cid_uuid, p_installation_id, v_type, v_uid,
      p_app_version, p_runtime_version, p_channel, v_status, v_reason, v_ts_parsed
    );
    v_new_count := v_new_count + 1;
    v_accepted := v_accepted || pg_catalog.to_jsonb(v_cid);
  end loop;

  -- Heartbeat: latest facts + last_seen (also on secret-verified
  -- requests with zero events — but never on a malformed request:
  -- those returned above, before any write).
  update public.app_installations i set
    platform = coalesce(p_platform, i.platform),
    os_version = p_os_version,
    app_version = p_app_version,
    version_code = p_version_code,
    runtime_version = p_runtime_version,
    channel = p_channel,
    current_update_id = p_current_update_id,
    is_embedded_launch = coalesce(p_is_embedded_launch, i.is_embedded_launch),
    last_seen_at = now()
  where i.id = p_installation_id;

  return pg_catalog.jsonb_build_object(
    'accepted', v_accepted,
    'duplicates', v_duplicates,
    'rejected', v_rejected,
    'event_id_pool', (
      select coalesce(pg_catalog.jsonb_agg(g), '[]'::jsonb)
      from (
        select pg_catalog.gen_random_uuid()::text as g
        from pg_catalog.generate_series(1, 50)
      ) pool
    )
  );
end;
$$;
revoke execute on function public.telemetry_ingest(uuid, text, text, text, text, integer, text, text, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.telemetry_ingest(uuid, text, text, text, text, integer, text, text, text, boolean, jsonb)
  to service_role;

-- =====================================================================
-- BOOTSTRAP — the only way an installation comes to exist. The app
-- contains no CSPRNG (verified: no expo-crypto in APK 1.1.8), so the
-- server mints the identity: id + secret from gen_random_uuid (OS
-- CSPRNG), the secret returned exactly once to the caller and stored
-- only as its SHA-256 hash. Also returns a pool of server-generated
-- event ids so the client never mints identifiers locally.
-- Registrations are capped at 500/hour under a dedicated advisory
-- lock (fake-install flood breaker).
-- =====================================================================
create or replace function public.telemetry_bootstrap(
  p_platform text,
  p_os_version text,
  p_app_version text,
  p_version_code integer,
  p_runtime_version text,
  p_channel text,
  p_current_update_id text,
  p_is_embedded_launch boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := pg_catalog.gen_random_uuid();
  v_secret text := replace(
    pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text,
    '-', '');
  v_count bigint;
begin
  perform pg_advisory_xact_lock(727272);
  select count(*) into v_count
  from public.app_installations i
  where i.first_seen_at > now() - interval '1 hour';
  if v_count >= 500 then
    return pg_catalog.jsonb_build_object('error', 'registration_throttled');
  end if;
  insert into public.app_installations (
    id, secret_hash, platform, os_version, app_version, version_code,
    runtime_version, channel, current_update_id, is_embedded_launch,
    first_seen_at, last_seen_at
  ) values (
    v_id,
    encode(pg_catalog.sha256(v_secret::bytea), 'hex'),
    coalesce(p_platform, 'android'),
    p_os_version, p_app_version, p_version_code, p_runtime_version,
    p_channel, p_current_update_id, p_is_embedded_launch,
    now(), now()
  );
  return pg_catalog.jsonb_build_object(
    'installation_id', v_id,
    'secret', v_secret,
    'event_id_pool', (
      select coalesce(pg_catalog.jsonb_agg(g), '[]'::jsonb)
      from (
        select pg_catalog.gen_random_uuid()::text as g
        from pg_catalog.generate_series(1, 100)
      ) pool
    )
  );
end;
$$;
revoke execute on function public.telemetry_bootstrap(text, text, text, integer, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.telemetry_bootstrap(text, text, text, integer, text, text, text, boolean)
  to service_role;

-- =====================================================================
-- DASHBOARD READS — logic lives in the dedicated private schema.
-- The public wrappers are SECURITY INVOKER pass-throughs holding no
-- privileges of their own; the private implementations are SECURITY
-- DEFINER (they read tables no client role may touch), re-check the
-- owner allowlist internally, and are executable by authenticated
-- only. The private schema is NOT in the Data API's exposed schemas,
-- so these functions cannot be reached over REST at all.
-- =====================================================================
create or replace function basera_telemetry_private.is_dashboard_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dashboard_owners o where o.user_id = auth.uid()
  );
$$;
revoke execute on function basera_telemetry_private.is_dashboard_owner() from public, anon, authenticated;

create or replace function basera_telemetry_private.dashboard_overview()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not basera_telemetry_private.is_dashboard_owner() then
    raise exception 'not authorized';
  end if;
  return json_build_object(
    'total_installations', (select count(*) from public.app_installations),
    'active_24h', (select count(*) from public.app_installations where last_seen_at > now() - interval '24 hours'),
    'active_7d', (select count(*) from public.app_installations where last_seen_at > now() - interval '7 days'),
    'dormant_7d', (select count(*) from public.app_installations where last_seen_at <= now() - interval '7 days'),
    'by_version', (
      select coalesce(json_agg(row_to_json(v) order by v.version_code desc nulls last), '[]'::json)
      from (
        select app_version, version_code, count(*)::int as installations
        from public.app_installations
        group by app_version, version_code
      ) v
    ),
    'latest_update_id', (
      select e.update_id from public.app_update_events e
      where e.update_id is not null
        and e.event_type in ('update_available', 'update_downloaded', 'update_applied')
      order by e.received_at desc limit 1
    )
  );
end;
$$;
revoke execute on function basera_telemetry_private.dashboard_overview() from public, anon;
grant execute on function basera_telemetry_private.dashboard_overview() to authenticated;

create or replace function basera_telemetry_private.dashboard_adoption()
returns table (
  update_id text,
  discovered bigint,
  downloaded bigint,
  applied bigint,
  failed bigint,
  adoption_pct numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not basera_telemetry_private.is_dashboard_owner() then
    raise exception 'not authorized';
  end if;
  return query
  with per_update as (
    select
      e.update_id as uid,
      count(distinct e.installation_id) filter (where e.event_type = 'update_available') as discovered,
      count(distinct e.installation_id) filter (where e.event_type = 'update_downloaded') as downloaded,
      count(distinct e.installation_id) filter (where e.event_type = 'update_applied') as applied,
      count(distinct e.installation_id) filter (where e.event_type = 'update_failed') as failed
    from public.app_update_events e
    where e.update_id is not null
    group by e.update_id
  )
  select
    p.uid, p.discovered, p.downloaded, p.applied, p.failed,
    case when p.discovered > 0 then round(100.0 * p.applied / p.discovered, 1) else 0 end as adoption_pct
  from per_update p
  order by p.applied desc, p.discovered desc;
end;
$$;
revoke execute on function basera_telemetry_private.dashboard_adoption() from public, anon;
grant execute on function basera_telemetry_private.dashboard_adoption() to authenticated;

create or replace function basera_telemetry_private.dashboard_installations(
  p_version text default null,
  p_update_id text default null,
  p_status text default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  installation_id uuid,
  app_version text,
  version_code integer,
  runtime_version text,
  channel text,
  last_seen_at timestamptz,
  current_update_id text,
  is_embedded_launch boolean,
  last_event_type text,
  last_event_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not basera_telemetry_private.is_dashboard_owner() then
    raise exception 'not authorized';
  end if;
  return query
  select
    i.id, i.app_version, i.version_code, i.runtime_version, i.channel,
    i.last_seen_at, i.current_update_id, i.is_embedded_launch,
    le.event_type, le.received_at
  from public.app_installations i
  left join lateral (
    select e.event_type, e.received_at
    from public.app_update_events e
    where e.installation_id = i.id
    order by e.received_at desc
    limit 1
  ) le on true
  where (p_version is null or i.app_version = p_version)
    and (p_update_id is null or i.current_update_id = p_update_id)
    and (p_status is null or le.event_type = p_status)
  order by i.last_seen_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 500))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke execute on function basera_telemetry_private.dashboard_installations(text, text, text, integer, integer)
  from public, anon;
grant execute on function basera_telemetry_private.dashboard_installations(text, text, text, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------
-- Public RPC surface: SECURITY INVOKER pass-throughs. They hold no
-- elevated privileges; authorization happens in the private layer.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_overview()
returns json
language sql
stable
security invoker
set search_path = ''
as $$ select basera_telemetry_private.dashboard_overview(); $$;
revoke execute on function public.dashboard_overview() from public, anon;
grant execute on function public.dashboard_overview() to authenticated;

create or replace function public.dashboard_adoption()
returns table (
  update_id text,
  discovered bigint,
  downloaded bigint,
  applied bigint,
  failed bigint,
  adoption_pct numeric
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from basera_telemetry_private.dashboard_adoption(); $$;
revoke execute on function public.dashboard_adoption() from public, anon;
grant execute on function public.dashboard_adoption() to authenticated;

create or replace function public.dashboard_installations(
  p_version text default null,
  p_update_id text default null,
  p_status text default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns table (
  installation_id uuid,
  app_version text,
  version_code integer,
  runtime_version text,
  channel text,
  last_seen_at timestamptz,
  current_update_id text,
  is_embedded_launch boolean,
  last_event_type text,
  last_event_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$ select * from basera_telemetry_private.dashboard_installations(p_version, p_update_id, p_status, p_limit, p_offset); $$;
revoke execute on function public.dashboard_installations(text, text, text, integer, integer)
  from public, anon;
grant execute on function public.dashboard_installations(text, text, text, integer, integer)
  to authenticated;
