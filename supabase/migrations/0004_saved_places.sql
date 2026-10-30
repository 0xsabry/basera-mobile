-- BASERA V1.1 — migration 0004: Smart Place Memory cloud sync.
--
-- PRIVACY CONTRACT: saved places belong to the blind user alone.
-- Guardians get NO access — there is deliberately no guardian policy
-- on this table, and RLS is owner-only (auth.uid() = user_id) for
-- every operation. Sync itself is opt-in from the app (default off).

create table if not exists public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The device's local place id, stable across syncs.
  local_id text not null,
  name text not null,
  category text not null check (category in (
    'home','university','work','family','hospital',
    'pharmacy','shop','mosque','transport','custom')),
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  note text not null default '',
  entrance_info text,
  obstacles_note text,
  favorite boolean not null default false,
  proximity_enabled boolean not null default true,
  place_created_at timestamptz not null,
  last_visited_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, local_id)
);

alter table public.saved_places enable row level security;

-- Owner-only: select/insert/update/delete all require ownership.
-- No guardian policy exists on purpose (guardians must never read
-- the user's saved places, even while linked for location sharing).
create policy saved_places_owner_select on public.saved_places
  for select using (auth.uid() = user_id);
create policy saved_places_owner_insert on public.saved_places
  for insert with check (auth.uid() = user_id);
create policy saved_places_owner_update on public.saved_places
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy saved_places_owner_delete on public.saved_places
  for delete using (auth.uid() = user_id);
