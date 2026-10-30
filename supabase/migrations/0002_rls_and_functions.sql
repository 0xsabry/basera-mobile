-- BASERA V1.1 Phase 1 — 0002: row level security, grants, and RPC functions.
-- Authorization model (owner-approved):
--   * A guardian can read a user's location IFF a guardian_links row with
--     status 'active' exists between them. Enforced HERE, never client-side.
--   * Pairing codes create PENDING links only; the owner must approve.
--   * The anon role gets NOTHING on any guardian table.
--   * Only the service role (Edge Functions) bypasses RLS.

-- ============================================================== enable RLS
alter table public.profiles enable row level security;
alter table public.device_settings enable row level security;
alter table public.guardian_links enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.pairing_attempts enable row level security;
alter table public.location_points enable row level security;
alter table public.latest_locations enable row level security;
alter table public.hazard_events enable row level security;
alter table public.push_endpoints enable row level security;

-- ================================================================== grants
-- Start from zero for the API roles on every guardian table.
revoke all on public.profiles, public.device_settings, public.guardian_links,
  public.pairing_codes, public.pairing_attempts, public.location_points,
  public.latest_locations, public.hazard_events, public.push_endpoints
  from anon, authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.device_settings to authenticated;
grant select on public.guardian_links to authenticated;
grant select on public.pairing_codes to authenticated;
grant insert, select, delete on public.location_points to authenticated;
grant select on public.latest_locations to authenticated;
grant insert, select, update on public.hazard_events to authenticated;
grant select, insert, update, delete on public.push_endpoints to authenticated;
-- anon: intentionally NO grants on any table above.

-- ================================================================ policies
-- profiles: self only.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select to authenticated using (auth.uid() = id);
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
-- Display names of the OTHER party in a link must be readable (pairing UI).
drop policy if exists profiles_link_party_select on public.profiles;
create policy profiles_link_party_select on public.profiles
  for select to authenticated using (
    exists (
      select 1 from public.guardian_links l
      where (l.owner_id = auth.uid() and l.guardian_id = public.profiles.id)
         or (l.guardian_id = auth.uid() and l.owner_id = public.profiles.id)
    )
  );

-- device_settings: self only.
drop policy if exists device_settings_self_all on public.device_settings;
create policy device_settings_self_all on public.device_settings
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- guardian_links: visible to the two parties. NO direct insert/update —
-- all transitions go through the security-definer RPCs below, so a client
-- can never mint or activate a link by writing the table.
drop policy if exists guardian_links_party_select on public.guardian_links;
create policy guardian_links_party_select on public.guardian_links
  for select to authenticated
  using (auth.uid() = owner_id or auth.uid() = guardian_id);

-- pairing_codes: owner can inspect own codes; creation/redemption only
-- via RPC (no direct insert/update policies exist).
drop policy if exists pairing_codes_owner_select on public.pairing_codes;
create policy pairing_codes_owner_select on public.pairing_codes
  for select to authenticated using (auth.uid() = owner_id);

-- pairing_attempts: no policies at all -> RPC functions only.

-- location_points: insert own; read own OR active-link guardian; delete own.
drop policy if exists location_points_insert_own on public.location_points;
create policy location_points_insert_own on public.location_points
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists location_points_select_own_or_active_guardian on public.location_points;
create policy location_points_select_own_or_active_guardian on public.location_points
  for select to authenticated using (
    auth.uid() = user_id
    or exists (
      select 1 from public.guardian_links l
      where l.owner_id = public.location_points.user_id
        and l.guardian_id = auth.uid()
        and l.status = 'active'
    )
  );
drop policy if exists location_points_delete_own on public.location_points;
create policy location_points_delete_own on public.location_points
  for delete to authenticated using (auth.uid() = user_id);

-- latest_locations: read own OR active-link guardian. No write policies:
-- the sync_latest_location trigger (security definer) is the only writer.
drop policy if exists latest_locations_select_own_or_active_guardian on public.latest_locations;
create policy latest_locations_select_own_or_active_guardian on public.latest_locations
  for select to authenticated using (
    auth.uid() = user_id
    or exists (
      select 1 from public.guardian_links l
      where l.owner_id = public.latest_locations.user_id
        and l.guardian_id = auth.uid()
        and l.status = 'active'
    )
  );

-- hazard_events: insert own; read own OR active-link guardian; ack own.
drop policy if exists hazard_events_insert_own on public.hazard_events;
create policy hazard_events_insert_own on public.hazard_events
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists hazard_events_select_own_or_active_guardian on public.hazard_events;
create policy hazard_events_select_own_or_active_guardian on public.hazard_events
  for select to authenticated using (
    auth.uid() = user_id
    or exists (
      select 1 from public.guardian_links l
      where l.owner_id = public.hazard_events.user_id
        and l.guardian_id = auth.uid()
        and l.status = 'active'
    )
  );
drop policy if exists hazard_events_update_own on public.hazard_events;
create policy hazard_events_update_own on public.hazard_events
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- push_endpoints: strictly own rows.
drop policy if exists push_endpoints_self_all on public.push_endpoints;
create policy push_endpoints_self_all on public.push_endpoints
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================ RPC functions
-- Codes: 6 digits, SHA-256 hashed at rest, 15-minute expiry, single-use.
create or replace function public.create_pairing_code()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
  -- Invalidate the caller's previous unused codes.
  update public.pairing_codes
    set used_at = now()
    where owner_id = auth.uid() and used_at is null;
  insert into public.pairing_codes (owner_id, code_hash, expires_at)
  values (auth.uid(), encode(digest(v_code, 'sha256'), 'hex'), v_expires);
  -- The raw code is returned exactly once; only its hash is stored.
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end;
$$;

-- Redeeming a code creates a PENDING link. It NEVER grants location
-- access by itself — the owner must approve (approve_link).
create or replace function public.redeem_pairing_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pairing_codes%rowtype;
  v_recent_attempts int;
  v_link public.guardian_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  -- Brute-force brake: max 10 redemption attempts per account per 15 min.
  insert into public.pairing_attempts (guardian_id) values (auth.uid());
  select count(*) into v_recent_attempts
    from public.pairing_attempts
    where guardian_id = auth.uid() and attempted_at > now() - interval '15 minutes';
  if v_recent_attempts > 10 then
    raise exception 'too many pairing attempts; try again later';
  end if;

  select * into v_row
    from public.pairing_codes
    where code_hash = encode(digest(p_code, 'sha256'), 'hex')
    order by created_at desc
    limit 1;
  if not found then
    raise exception 'invalid pairing code';
  end if;
  if v_row.owner_id = auth.uid() then
    raise exception 'you cannot pair with yourself';
  end if;
  if v_row.used_at is not null then
    update public.pairing_codes set attempts = attempts + 1 where id = v_row.id;
    raise exception 'pairing code already used';
  end if;
  if v_row.expires_at < now() then
    update public.pairing_codes set attempts = attempts + 1 where id = v_row.id;
    raise exception 'pairing code expired';
  end if;

  update public.pairing_codes set used_at = now() where id = v_row.id;

  insert into public.guardian_links (owner_id, guardian_id, status)
  values (v_row.owner_id, auth.uid(), 'pending')
  on conflict (owner_id, guardian_id) do update
    set status = case
          when public.guardian_links.status = 'revoked' then 'pending'
          else public.guardian_links.status
        end,
        revoked_at = case
          when public.guardian_links.status = 'revoked' then null
          else public.guardian_links.revoked_at
        end
  returning * into v_link;

  return jsonb_build_object('owner_id', v_link.owner_id, 'status', v_link.status);
end;
$$;

-- Owner approval: the ONLY path from pending to active.
create or replace function public.approve_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.guardian_links
    set status = 'active'
    where id = p_link_id and owner_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'no pending link owned by the caller with that id';
  end if;
end;
$$;

-- Revocation by either party takes effect immediately (RLS reads status).
-- When the OWNER revokes their LAST active guardian, stored locations are
-- purged: with no guardian left, the records have no remaining purpose.
create or replace function public.revoke_link(p_link_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.guardian_links%rowtype;
begin
  select * into v_link from public.guardian_links where id = p_link_id;
  if not found then
    raise exception 'link not found';
  end if;
  if auth.uid() <> v_link.owner_id and auth.uid() <> v_link.guardian_id then
    raise exception 'only a party to the link can revoke it';
  end if;
  update public.guardian_links
    set status = 'revoked', revoked_at = now()
    where id = p_link_id;

  if auth.uid() = v_link.owner_id then
    if not exists (
      select 1 from public.guardian_links
      where owner_id = v_link.owner_id and status = 'active'
    ) then
      delete from public.location_points where user_id = v_link.owner_id;
      delete from public.latest_locations where user_id = v_link.owner_id;
    end if;
  end if;
end;
$$;

-- Sharing toggle. false => uploads stop (client-side) AND all stored
-- location records of the caller are deleted server-side, immediately.
create or replace function public.set_sharing_enabled(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.device_settings (user_id, sharing_enabled, updated_at)
  values (auth.uid(), p_enabled, now())
  on conflict (user_id) do update
    set sharing_enabled = excluded.sharing_enabled, updated_at = now();
  if not p_enabled then
    delete from public.location_points where user_id = auth.uid();
    delete from public.latest_locations where user_id = auth.uid();
  end if;
end;
$$;

-- 24-hour retention purge. Called by pg_cron (see 0003) or by the
-- cleanup-locations Edge Function with the service-role key.
create or replace function public.cleanup_locations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from public.location_points
    where recorded_at < now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ========================================================== function grants
revoke all on function public.create_pairing_code() from public, anon;
revoke all on function public.redeem_pairing_code(text) from public, anon;
revoke all on function public.approve_link(uuid) from public, anon;
revoke all on function public.revoke_link(uuid) from public, anon;
revoke all on function public.set_sharing_enabled(boolean) from public, anon;
revoke all on function public.cleanup_locations() from public, anon, authenticated;
grant execute on function public.create_pairing_code() to authenticated;
grant execute on function public.redeem_pairing_code(text) to authenticated;
grant execute on function public.approve_link(uuid) to authenticated;
grant execute on function public.revoke_link(uuid) to authenticated;
grant execute on function public.set_sharing_enabled(boolean) to authenticated;
grant execute on function public.cleanup_locations() to service_role;
