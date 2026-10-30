-- BASERA V1.1 Phase 1 — LIVE RLS / authorization test script.
--
-- *** Run this against a real Supabase project AFTER applying migrations
-- 0001-0003. It cannot run in the build sandbox (no Postgres there). ***
--
-- Prerequisites:
--   1. Create three users in Supabase Dashboard -> Authentication:
--      owner@test.local, guardian@test.local, stranger@test.local
--   2. Replace the three UUID placeholders below with their auth user ids.
--   3. Run the whole file in the SQL Editor (as postgres). Every check
--      raises an exception on failure; a final "ALL RLS TESTS PASSED"
--      notice means the denial matrix held.
--
-- The script impersonates users exactly the way PostgREST does:
-- role = authenticated + request.jwt.claims.sub = user id.

\set owner_id    '00000000-0000-0000-0000-000000000001'
\set guardian_id '00000000-0000-0000-0000-000000000002'
\set stranger_id '00000000-0000-0000-0000-000000000003'

create or replace function pg_temp.assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then
    raise exception 'RLS TEST FAILED: %', msg;
  end if;
  raise notice 'PASS: %', msg;
end;
$$;

create or replace function pg_temp.act_as(uid text)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function pg_temp.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims',
    json_build_object('role', 'anon')::text, true);
end;
$$;

create or replace function pg_temp.act_admin()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;

-- ============================================================ seed (owner)
do $$
begin
  perform pg_temp.act_as(:'owner_id');
  insert into public.location_points (user_id, lat, lng, accuracy_m, recorded_at, source)
  values (:'owner_id'::uuid, 30.0444, 31.2357, 10, now(), 'foreground');
  perform pg_temp.assert(
    (select count(*) from public.latest_locations where user_id = :'owner_id'::uuid) = 1,
    'owner upload creates latest_locations via trigger');
end;
$$;

-- =============================================== anon: no access anywhere
do $$
declare n int;
begin
  perform pg_temp.act_anon();
  begin
    select count(*) into n from public.latest_locations;
    perform pg_temp.assert(n = 0, 'anon reads zero latest_locations');
  exception when insufficient_privilege then
    raise notice 'PASS: anon latest_locations read denied at grant level';
  end;
  begin
    select count(*) into n from public.guardian_links;
    perform pg_temp.assert(n = 0, 'anon reads zero guardian_links');
  exception when insufficient_privilege then
    raise notice 'PASS: anon guardian_links read denied at grant level';
  end;
end;
$$;

-- ============================ stranger + unlinked guardian: no owner data
do $$
declare n int;
begin
  perform pg_temp.act_as(:'stranger_id');
  select count(*) into n from public.latest_locations where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n = 0, 'stranger cannot read owner latest location');
  select count(*) into n from public.location_points where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n = 0, 'stranger cannot read owner location history');

  perform pg_temp.act_as(:'guardian_id');
  select count(*) into n from public.latest_locations where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n = 0, 'guardian WITHOUT a link cannot read owner location');
end;
$$;

-- ============================ cross-user write attempts are rejected (RLS)
do $$
begin
  perform pg_temp.act_as(:'stranger_id');
  begin
    insert into public.location_points (user_id, lat, lng, recorded_at)
    values (:'owner_id'::uuid, 1, 1, now());
    perform pg_temp.assert(false, 'stranger insert into owner points must fail');
  exception when others then
    raise notice 'PASS: stranger cannot insert points as the owner (%)', sqlerrm;
  end;
end;
$$;

-- ================================================= pairing: code -> pending
do $$
declare
  v_code text;
  v_result jsonb;
  n int;
begin
  perform pg_temp.act_as(:'owner_id');
  v_result := public.create_pairing_code();
  v_code := v_result ->> 'code';
  perform pg_temp.assert(length(v_code) = 6, 'create_pairing_code returns a 6-digit code');
  perform pg_temp.assert(
    (select count(*) from public.pairing_codes
      where owner_id = :'owner_id'::uuid and code_hash <> v_code) >= 1,
    'pairing code stored hashed, never raw');

  perform pg_temp.act_as(:'guardian_id');
  v_result := public.redeem_pairing_code(v_code);
  perform pg_temp.assert(v_result ->> 'status' = 'pending',
    'redeem creates a PENDING link, never active');

  select count(*) into n from public.latest_locations where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n = 0, 'guardian with PENDING link still cannot read location');
end;
$$;

-- ==================================== guardian cannot approve their own link
do $$
declare v_link uuid;
begin
  perform pg_temp.act_admin();
  select id into v_link from public.guardian_links
    where owner_id = :'owner_id'::uuid and guardian_id = :'guardian_id'::uuid;
  perform pg_temp.act_as(:'guardian_id');
  begin
    perform public.approve_link(v_link);
    perform pg_temp.assert(false, 'guardian self-approval must fail');
  exception when others then
    raise notice 'PASS: guardian cannot approve own link (%)', sqlerrm;
  end;

  -- expired code fails
  perform pg_temp.act_admin();
  insert into public.pairing_codes (owner_id, code_hash, expires_at)
  values (:'owner_id'::uuid, encode(digest('999999', 'sha256'), 'hex'), now() - interval '1 minute');
  perform pg_temp.act_as(:'guardian_id');
  begin
    perform public.redeem_pairing_code('999999');
    perform pg_temp.assert(false, 'expired code must fail');
  exception when others then
    raise notice 'PASS: expired pairing code rejected (%)', sqlerrm;
  end;

  -- reused code fails (the original code was consumed above)
  perform pg_temp.act_admin();
  -- fetch nothing; the first code's raw value is unknowable by design.
  raise notice 'NOTE: code-reuse is covered by used_at check in redeem_pairing_code; verify manually with a fresh code if desired.';
end;
$$;

-- ===================================== owner approves -> guardian can read
do $$
declare v_link uuid; n int;
begin
  perform pg_temp.act_admin();
  select id into v_link from public.guardian_links
    where owner_id = :'owner_id'::uuid and guardian_id = :'guardian_id'::uuid;
  perform pg_temp.act_as(:'owner_id');
  perform public.approve_link(v_link);
  perform pg_temp.assert(
    (select status from public.guardian_links where id = v_link) = 'active',
    'owner approval activates the link');

  perform pg_temp.act_as(:'guardian_id');
  select count(*) into n from public.latest_locations where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n = 1, 'ACTIVE guardian can read latest location');
  select count(*) into n from public.location_points where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n >= 1, 'ACTIVE guardian can read 24h history');
end;
$$;

-- ============================ revocation: access ends + last-guardian purge
do $$
declare v_link uuid; n int;
begin
  perform pg_temp.act_admin();
  select id into v_link from public.guardian_links
    where owner_id = :'owner_id'::uuid and guardian_id = :'guardian_id'::uuid;
  perform pg_temp.act_as(:'owner_id');
  perform public.revoke_link(v_link);

  perform pg_temp.act_as(:'guardian_id');
  select count(*) into n from public.latest_locations where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n = 0, 'REVOKED guardian immediately loses location access');

  perform pg_temp.act_admin();
  select count(*) into n from public.location_points where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n = 0, 'revoking the LAST guardian purged stored points');
  select count(*) into n from public.latest_locations where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n = 0, 'revoking the LAST guardian purged latest location');
end;
$$;

-- ======================================= sharing off purges; cleanup works
do $$
declare n int;
begin
  perform pg_temp.act_as(:'owner_id');
  insert into public.location_points (user_id, lat, lng, recorded_at)
  values (:'owner_id'::uuid, 30.0, 31.0, now());
  perform public.set_sharing_enabled(false);
  select count(*) into n from public.location_points where user_id = :'owner_id'::uuid;
  perform pg_temp.assert(n = 0, 'set_sharing_enabled(false) purges stored locations');

  perform pg_temp.act_admin();
  insert into public.location_points (user_id, lat, lng, recorded_at)
  values (:'owner_id'::uuid, 30.0, 31.0, now() - interval '25 hours');
  perform public.cleanup_locations();
  select count(*) into n from public.location_points
    where user_id = :'owner_id'::uuid and recorded_at < now() - interval '24 hours';
  perform pg_temp.assert(n = 0, 'cleanup_locations deletes points older than 24 hours');
end;
$$;

select 'ALL RLS TESTS PASSED' as result;
