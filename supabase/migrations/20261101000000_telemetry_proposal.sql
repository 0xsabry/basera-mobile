-- =====================================================================
-- PROPOSAL — NOT APPLIED TO PRODUCTION. DO NOT RUN without the owner's
-- explicit approval (owner rule: no production migration before review).
--
-- BASERA installations & OTA adoption telemetry.
-- Project: vbvvwyeccsegfwprwrga (the existing project — no new project).
--
-- What this creates:
--   * app_installations  — one anonymous row per app install.
--   * app_update_events  — append-only OTA lifecycle events.
--   * dashboard_owners   — allowlist of auth user ids allowed to read
--                          the owner dashboard data.
--   * is_dashboard_owner() + three dashboard RPC functions; the RPCs
--     are the ONLY read path and they refuse non-owners.
--
-- Security:
--   * RLS enabled on all tables with NO client policies: anon and
--     authenticated roles can read/write NOTHING directly.
--   * Writes happen only through the telemetry-ingest Edge Function
--     (service role inside the function; the key never ships in the app).
--   * No personal data: no user ids, no location, no device hardware
--     identifiers. Installations are anonymous random UUIDs.
--
-- After applying: register the owner by inserting their Supabase Auth
-- user id (Dashboard > Authentication > Users) into dashboard_owners:
--   insert into public.dashboard_owners (user_id) values ('<OWNER_AUTH_UID>');
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

create or replace function public.is_dashboard_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.dashboard_owners o where o.user_id = auth.uid());
$$;

create or replace function public.dashboard_overview()
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_dashboard_owner() then
    raise exception 'not authorized';
  end if;
  return json_build_object(
    'total_installations', (select count(*) from app_installations),
    'active_24h', (select count(*) from app_installations where last_seen_at > now() - interval '24 hours'),
    'active_7d', (select count(*) from app_installations where last_seen_at > now() - interval '7 days'),
    'dormant_7d', (select count(*) from app_installations where last_seen_at <= now() - interval '7 days'),
    'by_version', (
      select coalesce(json_agg(row_to_json(v) order by v.version_code desc nulls last), '[]'::json)
      from (
        select app_version, version_code, count(*)::int as installations
        from app_installations
        group by app_version, version_code
      ) v
    ),
    'latest_update_id', (
      select update_id from app_update_events
      where update_id is not null and event_type in ('update_available', 'update_downloaded', 'update_applied')
      order by received_at desc limit 1
    )
  );
end;
$$;

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
set search_path = public
as $$
begin
  if not public.is_dashboard_owner() then
    raise exception 'not authorized';
  end if;
  return query
  with per_update as (
    select
      e.update_id,
      count(distinct e.installation_id) filter (where e.event_type = 'update_available') as discovered,
      count(distinct e.installation_id) filter (where e.event_type = 'update_downloaded') as downloaded,
      count(distinct e.installation_id) filter (where e.event_type = 'update_applied') as applied,
      count(distinct e.installation_id) filter (where e.event_type = 'update_failed') as failed
    from app_update_events e
    where e.update_id is not null
    group by e.update_id
  )
  select
    p.update_id, p.discovered, p.downloaded, p.applied, p.failed,
    case when p.discovered > 0 then round(100.0 * p.applied / p.discovered, 1) else 0 end as adoption_pct
  from per_update p
  order by p.applied desc, p.discovered desc;
end;
$$;

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
set search_path = public
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
  from app_installations i
  left join lateral (
    select e.event_type, e.received_at
    from app_update_events e
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

grant execute on function public.dashboard_overview() to authenticated;
grant execute on function public.dashboard_adoption() to authenticated;
grant execute on function public.dashboard_installations(text, text, text, integer) to authenticated;
