-- =====================================================================
-- PROPOSAL v3 — NOT APPLIED TO PRODUCTION. DO NOT RUN without the
-- owner's explicit approval after final review (owner rule: no
-- production migration before it is shown to him and approved).
--
-- BASERA installations & OTA adoption telemetry.
-- Project: vbvvwyeccsegfwprwrga (the existing project — no new project).
-- This migration is ADDITIVE ONLY: new schema objects, nothing that
-- exists in production is altered or dropped.
--
-- v3 changes (owner review round 2):
--   * ALL ingest writes move into ONE database function,
--     public.telemetry_ingest(), executed in a single transaction:
--     per-installation advisory lock, pin-or-verify secret, strict
--     per-event classification (new / duplicate / invalid with a
--     reason), and an atomic hourly budget that duplicates and
--     invalid events never consume. Concurrent requests for the same
--     installation are serialized by the lock, so the budget and the
--     first-registration secret pin cannot race.
--   * Dashboard read logic moves to the `private` schema; the public
--     schema exposes only three thin RPC wrappers, each still gated
--     by the owner allowlist inside the private implementation.
--   * dashboard_installations gains p_offset and a clamped p_limit
--     (floor 1, ceiling 500) for paging as the fleet grows.
--
-- Security:
--   * Every SECURITY DEFINER function uses SET search_path = '' and
--     fully schema-qualified object names.
--   * EXECUTE revoked from PUBLIC and anon on every function.
--     telemetry_ingest is granted to service_role ONLY (the Edge
--     Function calls it; clients can never call it directly).
--     The public dashboard wrappers are granted to authenticated
--     ONLY and refuse non-owners internally.
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
-- installations; the system is not — and does not claim to be —
-- tamper-proof against the owner of a modified device. Adoption
-- ratios between funnel stages are the robust signal.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

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
  is_embedded_launch boolean not null default true,
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
--   advisory lock (per installation) -> pin-or-verify secret ->
--   classify events (invalid / duplicate / new) -> atomic budget ->
--   insert new events -> heartbeat. Returns per-event verdicts so the
--   client removes accepted+duplicate events from its queue, moves
--   rejected ones to a local dead-letter store, and keeps everything
--   when the request itself fails.
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
  v_recent integer;
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
  v_budget integer := 600;
  v_new_count integer := 0;
begin
  if p_installation_id is null or p_secret_hash is null or length(p_secret_hash) <> 64 then
    return jsonb_build_object('error', 'invalid_installation_credentials');
  end if;

  -- Serialize everything for this installation: first-registration
  -- secret pinning and the hourly budget are race-free under this lock.
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(p_installation_id::text, 0));

  select * into v_inst from public.app_installations i where i.id = p_installation_id;
  v_found := found;

  if not v_found then
    insert into public.app_installations (
      id, secret_hash, platform, os_version, app_version, version_code,
      runtime_version, channel, current_update_id, is_embedded_launch,
      first_seen_at, last_seen_at
    ) values (
      p_installation_id, p_secret_hash, coalesce(p_platform, 'android'),
      p_os_version, p_app_version, p_version_code, p_runtime_version,
      p_channel, p_current_update_id, coalesce(p_is_embedded_launch, true),
      now(), now()
    );
  elsif v_inst.secret_hash <> p_secret_hash then
    return jsonb_build_object('error', 'secret_mismatch');
  end if;

  -- Events received in the trailing hour (budget base). Duplicates
  -- and invalid events below never add to this count.
  select count(*) into v_recent
  from public.app_update_events e
  where e.installation_id = p_installation_id
    and e.received_at > now() - interval '1 hour';

  if p_events is not null and pg_catalog.jsonb_typeof(p_events) = 'array' then
    for v_ev in select value from pg_catalog.jsonb_array_elements(p_events)
    loop
      v_err := null;
      v_cid := v_ev ->> 'client_event_id';
      v_type := v_ev ->> 'event_type';
      v_uid := v_ev ->> 'update_id';
      v_status := coalesce(v_ev ->> 'status', 'ok');
      v_reason := v_ev ->> 'failure_reason';
      v_ts := v_ev ->> 'client_ts';
      v_cid_uuid := null;
      v_ts_parsed := null;

      -- Strict validation: an invalid field rejects the EVENT with a
      -- reason. Nothing is silently coerced to null and stored.
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

      if v_err is not null then
        v_rejected := v_rejected || pg_catalog.jsonb_build_object(
          'client_event_id', v_cid, 'reason', v_err);
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
  end if;

  -- Heartbeat: latest facts + last_seen (also on secret-verified
  -- requests with zero events).
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
    'rejected', v_rejected
  );
end;
$$;
revoke execute on function public.telemetry_ingest(uuid, text, text, text, text, integer, text, text, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.telemetry_ingest(uuid, text, text, text, text, integer, text, text, text, boolean, jsonb)
  to service_role;

-- =====================================================================
-- DASHBOARD READS — logic lives in the private schema. The public
-- wrappers are the entire client-facing surface; each private
-- implementation re-checks the owner allowlist itself.
-- =====================================================================
create or replace function private.is_dashboard_owner()
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
revoke execute on function private.is_dashboard_owner() from public, anon, authenticated;

create or replace function private.dashboard_overview()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_dashboard_owner() then
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
revoke execute on function private.dashboard_overview() from public, anon, authenticated;

create or replace function private.dashboard_adoption()
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
  if not private.is_dashboard_owner() then
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
revoke execute on function private.dashboard_adoption() from public, anon, authenticated;

create or replace function private.dashboard_installations(
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
  if not private.is_dashboard_owner() then
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
revoke execute on function private.dashboard_installations(text, text, text, integer, integer)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Public RPC surface (thin wrappers; the private implementations
-- enforce the owner gate).
-- ---------------------------------------------------------------------
create or replace function public.dashboard_overview()
returns json
language sql
stable
security definer
set search_path = ''
as $$ select private.dashboard_overview(); $$;
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
security definer
set search_path = ''
as $$ select * from private.dashboard_adoption(); $$;
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
security definer
set search_path = ''
as $$ select * from private.dashboard_installations(p_version, p_update_id, p_status, p_limit, p_offset); $$;
revoke execute on function public.dashboard_installations(text, text, text, integer, integer)
  from public, anon;
grant execute on function public.dashboard_installations(text, text, text, integer, integer)
  to authenticated;
