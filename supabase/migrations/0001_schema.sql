-- BASERA V1.1 Phase 1 — 0001: schema
-- Guardian location sharing on Supabase (Postgres + Auth + RLS).
-- Apply order: 0001 -> 0002 -> 0003. RLS + grants live in 0002.
-- Privacy contract (owner-approved):
--   * Detailed GPS history is retained at most 24 hours (cleanup in 0002).
--   * Only the latest location is kept while sharing is active.
--   * Sharing off / last-guardian revocation purges stored locations.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------- device settings
-- Mirrors the phone's sharing consent. The phone is the source of truth;
-- the server never turns sharing ON by itself.
create table if not exists public.device_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  sharing_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------- guardian links
create table if not exists public.guardian_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  guardian_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (owner_id, guardian_id),
  check (owner_id <> guardian_id)
);
create index if not exists guardian_links_owner_status_idx
  on public.guardian_links (owner_id, status);
create index if not exists guardian_links_guardian_status_idx
  on public.guardian_links (guardian_id, status);

-- ------------------------------------------------------------ pairing codes
-- Only the SHA-256 hash of a code is stored. Codes expire after 15 minutes
-- and are single-use. The raw code is returned once by create_pairing_code.
create table if not exists public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists pairing_codes_hash_idx
  on public.pairing_codes (code_hash) where used_at is null;

-- Per-account redemption throttle log (brute-force brake; see redeem fn).
create table if not exists public.pairing_attempts (
  id bigint generated always as identity primary key,
  guardian_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);
create index if not exists pairing_attempts_guardian_time_idx
  on public.pairing_attempts (guardian_id, attempted_at desc);

-- ---------------------------------------------------------- location points
create table if not exists public.location_points (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision,
  recorded_at timestamptz not null,
  source text not null default 'foreground'
    check (source in ('foreground', 'background')),
  created_at timestamptz not null default now()
);
create index if not exists location_points_user_time_idx
  on public.location_points (user_id, recorded_at desc);

-- --------------------------------------------------------- latest locations
-- One row per user; kept only while sharing is active (purged with the
-- points when sharing is disabled). Written ONLY by the sync trigger
-- below — clients have no direct write path (see RLS in 0002).
create table if not exists public.latest_locations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create or replace function public.sync_latest_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.latest_locations (user_id, lat, lng, accuracy_m, recorded_at, updated_at)
  values (new.user_id, new.lat, new.lng, new.accuracy_m, new.recorded_at, now())
  on conflict (user_id) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        accuracy_m = excluded.accuracy_m,
        recorded_at = excluded.recorded_at,
        updated_at = now()
    where excluded.recorded_at >= public.latest_locations.recorded_at;
  return new;
end;
$$;

drop trigger if exists location_points_sync_latest on public.location_points;
create trigger location_points_sync_latest
  after insert on public.location_points
  for each row execute function public.sync_latest_location();

-- ------------------------------------------------------------ hazard events
-- Table only in Phase 1 (plan section 4.2). The app starts writing events
-- in Phase 3; no live hazard alerts exist yet.
create table if not exists public.hazard_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  hazard_class text not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  confidence double precision,
  direction text,
  proximity_category text,
  source text not null check (source in ('phone-yolo', 'glasses-metadata', 'manual-sos')),
  acknowledged_at timestamptz,
  guardian_notified_at timestamptz
);
create index if not exists hazard_events_user_time_idx
  on public.hazard_events (user_id, created_at desc);

-- ------------------------------------------------------------ push endpoints
-- Android app notifications and guardian web notifications are SEPARATE
-- endpoint kinds (owner correction): 'android-expo' holds an Expo push
-- token; 'web-fcm' holds an FCM Web Push registration token. Sending is
-- done exclusively by Edge Functions with server-side credentials.
create table if not exists public.push_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('android-expo', 'web-fcm')),
  endpoint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, endpoint)
);

-- ------------------------------------------------------------- signup hook
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.device_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
