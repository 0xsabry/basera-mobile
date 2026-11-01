-- =====================================================================
-- PROPOSAL v2 — NOT APPLIED TO PRODUCTION. DO NOT RUN without the
-- owner's explicit approval after review (owner rule: no production
-- migration before it is shown to him and approved).
--
-- BASERA installations & OTA adoption telemetry.
-- Project: vbvvwyeccsegfwprwrga (the existing project — no new project).
-- This migration is ADDITIVE ONLY: it creates new tables/functions and
-- touches nothing that already exists in production.
--
-- What this creates:
--   * public.app_installations  — one anonymous row per app install.
--   * public.app_update_events  — append-only OTA lifecycle events.
--   * public.dashboard_owners   — allowlist of auth user ids allowed
--                                 to read the owner dashboard data.
--   * public.is_dashboard_owner() + three dashboard RPC functions.
--     The RPCs are the ONLY read path and each one refuses callers
--     whose auth.uid() is not in dashboard_owners.
--
-- Security (owner phase-2 controls):
--   * Every SECURITY DEFINER function uses SET search_path = '' and
--     fully schema-qualified object names.
--   * EXECUTE is revoked from PUBLIC and anon on every function;
--     the three dashboard RPCs are granted to authenticated ONLY
--     (and they still refuse non-owners internally). The helper
--     is_dashboard_owner() is granted to no client role.
--   * RLS enabled on all tables with NO client policies, and all
--     privileges revoked from anon/authenticated: direct table reads
--     from any client are impossible.
--   * Writes happen only through the telemetry-ingest Edge Function
--     (service role inside the function; the key never ships in the
--     app). No service-role key exists in the app.
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
-- installation id (it is bound to their secret) or register extra
-- fake installations; the system is not — and does not claim to be —
-- tamper-proof against the owner of a modified device. Adoption
-- ratios between funnel stages are the robust signal.
-- =====================================================================

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

create table if not exists public.dashboard_owners (
  user_id uuid primary key
);

alter table public.app_installations enable row level security;
alter table public.app_update_events enable row level security;
alter table public.dashboard_owners enable row level security;
-- No policies on purpose: direct table access is denied to every
-- client role. The service role (Edge Function) bypasses RLS.

revoke all on public.app_installations, public.app_update_events, public.dashboard_owners
  from anon, authenticated;

-- ---------------------------------------------------------------------
-- Owner gate helper. SECURITY DEFINER, empty search_path, qualified
-- names. Granted to NO client role — only the dashboard RPCs below
-- (same owner) call it.
-- ---------------------------------------------------------------------
create or replace function public.is_dashboard_owner()
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
revoke execute on function public.is_dashboard_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Dashboard RPC: overview counters + version distribution.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_overview()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_dashboard_owner() then
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
revoke execute on function public.dashboard_overview() from public, anon;
grant execute on function public.dashboard_overview() to authenticated;

-- ---------------------------------------------------------------------
-- Dashboard RPC: per-update adoption funnel (distinct installations
-- per stage). adoption_pct = applied / discovered.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_adoption()
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
  if not public.is_dashboard_owner() then
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
revoke execute on function public.dashboard_adoption() from public, anon;
grant execute on function public.dashboard_adoption() to authenticated;

-- ---------------------------------------------------------------------
-- Dashboard RPC: device list with filters (version / running update /
-- last event type), most recently seen first.
-- ---------------------------------------------------------------------
create or replace function public.dashboard_installations(
  p_version text default null,
  p_update_id text default null,
  p_status text default null,
  p_limit integer default 200
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
  if not public.is_dashboard_owner() then
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
  limit least(coalesce(p_limit, 200), 500);
end;
$$;
revoke execute on function public.dashboard_installations(text, text, text, integer) from public, anon;
grant execute on function public.dashboard_installations(text, text, text, integer) to authenticated;
