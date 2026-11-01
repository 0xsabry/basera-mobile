-- ============================================================================
-- BASERA — Supabase BASELINE: deployed state of project vbvvwyeccsegfwprwrga
-- ============================================================================
--
-- WHAT THIS FILE IS
--   A documentation baseline: it describes, as SQL, the schema that is
--   ALREADY LIVE in the owner's Supabase project
--   (https://vbvvwyeccsegfwprwrga.supabase.co), as behaviourally verified
--   against the running project on 2026-10-31. The authoritative contract
--   is docs/SUPABASE_INTEGRATION.md; the live harness
--   scripts/live-rls-test.mjs passed 22/22 gated cases on 2026-10-31.
--   Baseline captured 2026-11-01 from that verified contract.
--
-- WHAT THIS FILE IS NOT
--   * It was NOT applied to production by this repo, and it must NEVER be
--     re-applied to the live project — it already IS the live state.
--     Running it against production is unnecessary and must not happen.
--   * It is NOT a substitute for a CLI schema dump. Before ANY CLI-driven
--     change, reconcile this file with `supabase db pull` from the live
--     project and resolve any drift in favour of the live project.
--   * Any production change needs a new timestamped migration, a review,
--     and the owner's explicit approval (Release Gate — see
--     supabase/README.md).
--
-- VERIFIED vs UNVERIFIED
--   Verified by the live harness / authenticated probes (2026-10-31):
--   table and column names, primary keys, the defaults called out per
--   column below, expo_push_token NOT NULL, the platform CHECK rejecting
--   values such as 'android-expo', RLS enabled with the access matrix
--   implemented by the policies below, ZERO grants for the anon role
--   (authenticated-only access), and Realtime streaming on
--   guardian_locations + sos_alerts.
--   Details the contract does NOT establish are flagged inline with
--   "-- UNVERIFIED:" and are also listed in supabase/README.md. Do not
--   treat flagged items as fact.
--
-- ============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+; pgcrypto guard kept so
-- this file also parses on a bare local Postgres.
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- public.profiles
-- One row per user. id IS the auth user id; a client insert MUST include
-- it (inserting {} violates RLS). There is NO signup trigger — both
-- clients idempotently ensure their own row after sign-in.
-- There are NO consent columns here: consent is per-link, on
-- guardian_links.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key,  -- = auth.uid(); no default on purpose: the client must supply it
  display_name       text,
  preferred_language text not null default 'ar',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
  -- UNVERIFIED: no foreign key to auth.users(id) is asserted — referential
  -- constraints against auth.users are not established by the contract.
  -- UNVERIFIED: how updated_at is maintained (trigger vs client-written)
  -- is not established by the contract.
);

comment on table public.profiles is
  'BASERA user profile. id = auth user id. No consent columns (consent is per-link on guardian_links). Baseline of deployed state — see docs/SUPABASE_INTEGRATION.md.';

-- ----------------------------------------------------------------------------
-- public.guardian_links — pairing + PER-LINK consent
-- Rows are created ONLY by the accept-guardian-invite Edge Function
-- (service role); there is no client INSERT path and NO approval step —
-- a link is active immediately. There is NO status column.
-- Consent flags are wearer-controlled: only the subject (wearer) can
-- update the row; the same update by the guardian affects 0 rows.
-- Either party can delete (unlink); deletion immediately ends all
-- link-scoped access.
-- ----------------------------------------------------------------------------
create table if not exists public.guardian_links (
  id                       uuid primary key default gen_random_uuid(),
  subject_user_id          uuid not null,  -- the wearer
  guardian_user_id         uuid not null,  -- the guardian
  location_sharing_enabled boolean not null default false,
  sos_sharing_enabled      boolean not null default false,
  consent_version          text not null default '1.0',
  -- UNVERIFIED: '1.0' is the observed value; whether it comes from a
  -- column DEFAULT or is always written by accept-guardian-invite is not
  -- established by the contract.
  accepted_at              timestamptz,
  -- UNVERIFIED: accepted_at nullability/default is not established; it is
  -- recorded here as a plain timestamp set when the link is accepted.
  created_at               timestamptz not null default now()
  -- UNVERIFIED: accept is idempotent per (subject, guardian) pair —
  -- verified behaviourally (re-accept returns the same link_id) — but
  -- whether that is enforced by a UNIQUE constraint or by function logic
  -- is not established, so no unique constraint is asserted here.
  -- UNVERIFIED: no foreign keys to auth.users(id) are asserted (see
  -- profiles note).
);

comment on table public.guardian_links is
  'Pairing link between a wearer (subject_user_id) and a guardian (guardian_user_id) carrying PER-LINK consent flags, both default FALSE. Created only by the accept-guardian-invite Edge Function. Baseline of deployed state — see docs/SUPABASE_INTEGRATION.md.';

-- ----------------------------------------------------------------------------
-- public.guardian_locations — latest fix ONLY (one row per wearer)
-- The wearer upserts on subject_user_id and may write even with consent
-- off. Guardian READS are gated by their link's
-- location_sharing_enabled: with the flag off, a guardian select returns
-- [] even though the row exists. The wearer can delete their own row
-- (the app does so when sharing is switched off). There is NO history
-- table in the deployed project.
-- ----------------------------------------------------------------------------
create table if not exists public.guardian_locations (
  subject_user_id uuid primary key,
  latitude        double precision not null,
  longitude       double precision not null,
  -- UNVERIFIED: exact numeric types of latitude/longitude/accuracy_m are
  -- not established by the contract; double precision is the standard
  -- representation used here.
  accuracy_m      double precision,
  recorded_at     timestamptz not null default now(),
  -- recorded_at is server-set at insert (verified); whether that is this
  -- DEFAULT or a trigger is UNVERIFIED.
  updated_at      timestamptz not null default now()
);

comment on table public.guardian_locations is
  'Latest known location per wearer (latest-only, no history). Guardian reads gated by guardian_links.location_sharing_enabled. Baseline of deployed state — see docs/SUPABASE_INTEGRATION.md.';

-- ----------------------------------------------------------------------------
-- public.sos_alerts — append-only alert log
-- The wearer inserts (at the table level this is allowed even with SOS
-- consent off; the APP only inserts when the wearer's aggregate SOS
-- consent is on, otherwise the SOS stays a local-only state).
-- Guardian reads are gated by their link's sos_sharing_enabled.
-- Resolve is WEARER-ONLY: a guardian update affects 0 rows even with
-- consent on. Clients CANNOT delete alerts — there is deliberately no
-- DELETE policy; removal requires an owner (Dashboard/SQL) action.
-- ----------------------------------------------------------------------------
create table if not exists public.sos_alerts (
  id              uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null,
  latitude        double precision,
  longitude       double precision,
  accuracy_m      double precision,
  status          text not null default 'active',
  message         text,
  triggered_at    timestamptz not null default now(),
  resolved_at     timestamptz
);

comment on table public.sos_alerts is
  'SOS alerts. Wearer-only resolve; NO client delete (append-only). Guardian reads gated by guardian_links.sos_sharing_enabled. Baseline of deployed state — see docs/SUPABASE_INTEGRATION.md.';

-- ----------------------------------------------------------------------------
-- public.user_push_tokens — Expo push token registration
-- Registration only: the app registers after sign-in (only when
-- notification permission was already granted), refreshes on token
-- rotation, and deletes its rows on sign-out. Push DELIVERY is untested
-- and is not claimed anywhere. There is no web/FCM endpoint table in the
-- deployed project.
-- ----------------------------------------------------------------------------
create table if not exists public.user_push_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null,
  expo_push_token text not null,
  platform        text not null check (platform in ('android', 'ios')),
  -- UNVERIFIED: 'android' is positively verified (the app registers it,
  -- and values like 'android-expo' are rejected by the CHECK). 'ios' is
  -- included from the contract's design-difference notes ("'android'/
  -- 'ios'-style values"); the exact full CHECK list was not enumerated
  -- by a probe.
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
  -- UNVERIFIED: no uniqueness constraint on (user_id, expo_push_token)
  -- is asserted — none is established by the contract.
);

comment on table public.user_push_tokens is
  'Expo push tokens per user (registration only; delivery untested). platform CHECK verified to accept ''android'' and reject ''android-expo''. Baseline of deployed state — see docs/SUPABASE_INTEGRATION.md.';

-- ============================================================================
-- Grants
-- Verified: the anon role has ZERO grants on these tables — access is
-- authenticated-only. Row-level access for authenticated users is then
-- governed by the RLS policies below.
-- ============================================================================
revoke all on public.profiles           from anon;
revoke all on public.guardian_links     from anon;
revoke all on public.guardian_locations from anon;
revoke all on public.sos_alerts         from anon;
revoke all on public.user_push_tokens   from anon;

grant select, insert, update, delete on public.profiles           to authenticated;
grant select, insert, update, delete on public.guardian_links     to authenticated;
grant select, insert, update, delete on public.guardian_locations to authenticated;
grant select, insert, update, delete on public.sos_alerts         to authenticated;
grant select, insert, update, delete on public.user_push_tokens   to authenticated;
-- Note: table-level grants do not widen access beyond the RLS policies:
-- e.g. sos_alerts has no DELETE policy, so authenticated deletes are
-- still denied by RLS (append-only), exactly as verified live.

-- ============================================================================
-- Row Level Security — enabled on all five tables (verified).
-- The policies below implement the harness-verified access matrix.
-- ============================================================================
alter table public.profiles           enable row level security;
alter table public.guardian_links     enable row level security;
alter table public.guardian_locations enable row level security;
alter table public.sos_alerts         enable row level security;
alter table public.user_push_tokens   enable row level security;

-- ---- profiles ---------------------------------------------------------------
-- Read: own row always; a LINKED guardian can read the wearer's profile;
-- an unlinked user cannot.
drop policy if exists "profiles_select_own_or_linked_guardian" on public.profiles;
create policy "profiles_select_own_or_linked_guardian"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.guardian_links gl
      where gl.subject_user_id = profiles.id
        and gl.guardian_user_id = auth.uid()
    )
  );

-- Insert: only your own row, and the id MUST be supplied (= auth.uid()).
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- Update: own row only.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Delete: own row only.
-- UNVERIFIED: a dedicated profiles-delete case was not separately
-- harness-tested; this reflects the documented "delete my data" flow,
-- in which the app removes the user's own rows before sign-out.
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  to authenticated
  using (id = auth.uid());

-- ---- guardian_links ---------------------------------------------------------
-- Read: both parties to the link can see it.
drop policy if exists "guardian_links_select_parties" on public.guardian_links;
create policy "guardian_links_select_parties"
  on public.guardian_links for select
  to authenticated
  using (subject_user_id = auth.uid() or guardian_user_id = auth.uid());

-- INSERT: intentionally NO policy. Links are created only by the
-- accept-guardian-invite Edge Function (service role, bypasses RLS).
-- Direct client inserts are denied.

-- Update: WEARER (subject) ONLY — consent is wearer-controlled. The same
-- update attempted by the guardian silently affects 0 rows (verified).
drop policy if exists "guardian_links_update_subject_only" on public.guardian_links;
create policy "guardian_links_update_subject_only"
  on public.guardian_links for update
  to authenticated
  using (subject_user_id = auth.uid())
  with check (subject_user_id = auth.uid());

-- Delete (unlink): EITHER party can delete the link (verified in both
-- directions); deletion ends all link-scoped access immediately.
drop policy if exists "guardian_links_delete_either_party" on public.guardian_links;
create policy "guardian_links_delete_either_party"
  on public.guardian_links for delete
  to authenticated
  using (subject_user_id = auth.uid() or guardian_user_id = auth.uid());

-- ---- guardian_locations -----------------------------------------------------
-- Read: the wearer reads their own row; a guardian reads it ONLY while
-- their link's location_sharing_enabled is true (flag off => [] even
-- though the row exists — verified).
drop policy if exists "guardian_locations_select_own_or_consented_guardian" on public.guardian_locations;
create policy "guardian_locations_select_own_or_consented_guardian"
  on public.guardian_locations for select
  to authenticated
  using (
    subject_user_id = auth.uid()
    or exists (
      select 1 from public.guardian_links gl
      where gl.subject_user_id = guardian_locations.subject_user_id
        and gl.guardian_user_id = auth.uid()
        and gl.location_sharing_enabled
    )
  );

-- Write: wearer only, for their own row (upsert on subject_user_id);
-- allowed even while consent is off (verified).
drop policy if exists "guardian_locations_insert_own" on public.guardian_locations;
create policy "guardian_locations_insert_own"
  on public.guardian_locations for insert
  to authenticated
  with check (subject_user_id = auth.uid());

drop policy if exists "guardian_locations_update_own" on public.guardian_locations;
create policy "guardian_locations_update_own"
  on public.guardian_locations for update
  to authenticated
  using (subject_user_id = auth.uid())
  with check (subject_user_id = auth.uid());

-- Delete: wearer deletes their own latest row (the app does this when
-- sharing is switched off — verified).
drop policy if exists "guardian_locations_delete_own" on public.guardian_locations;
create policy "guardian_locations_delete_own"
  on public.guardian_locations for delete
  to authenticated
  using (subject_user_id = auth.uid());

-- ---- sos_alerts -------------------------------------------------------------
-- Read: the wearer reads their own alerts; a guardian reads them ONLY
-- while their link's sos_sharing_enabled is true (verified).
drop policy if exists "sos_alerts_select_own_or_consented_guardian" on public.sos_alerts;
create policy "sos_alerts_select_own_or_consented_guardian"
  on public.sos_alerts for select
  to authenticated
  using (
    subject_user_id = auth.uid()
    or exists (
      select 1 from public.guardian_links gl
      where gl.subject_user_id = sos_alerts.subject_user_id
        and gl.guardian_user_id = auth.uid()
        and gl.sos_sharing_enabled
    )
  );

-- Insert: wearer inserts their own alerts (verified; the table allows it
-- even with SOS consent off — gating at insert time is the app's job).
drop policy if exists "sos_alerts_insert_own" on public.sos_alerts;
create policy "sos_alerts_insert_own"
  on public.sos_alerts for insert
  to authenticated
  with check (subject_user_id = auth.uid());

-- Update (resolve): WEARER ONLY — the wearer sets status='resolved' +
-- resolved_at; a guardian update affects 0 rows even with consent on
-- (verified).
drop policy if exists "sos_alerts_update_subject_only" on public.sos_alerts;
create policy "sos_alerts_update_subject_only"
  on public.sos_alerts for update
  to authenticated
  using (subject_user_id = auth.uid())
  with check (subject_user_id = auth.uid());

-- DELETE: intentionally NO policy — clients cannot delete alerts
-- (verified). The log is append-only; removal requires an owner
-- Dashboard/SQL action.

-- ---- user_push_tokens -------------------------------------------------------
-- All operations: own rows only ("push-token privacy" was a harness
-- case: other users cannot read your tokens).
drop policy if exists "user_push_tokens_select_own" on public.user_push_tokens;
create policy "user_push_tokens_select_own"
  on public.user_push_tokens for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_push_tokens_insert_own" on public.user_push_tokens;
create policy "user_push_tokens_insert_own"
  on public.user_push_tokens for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_push_tokens_update_own" on public.user_push_tokens;
create policy "user_push_tokens_update_own"
  on public.user_push_tokens for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_push_tokens_delete_own" on public.user_push_tokens;
create policy "user_push_tokens_delete_own"
  on public.user_push_tokens for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- Realtime
-- Verified live (2026-10-31): guardian_locations and sos_alerts stream
-- over postgres_changes; a guardian subscribed with a
-- subject_user_id=eq.<wearer> filter received the wearer's location
-- INSERT/UPDATE and SOS INSERT events within seconds. Membership in the
-- supabase_realtime publication below is the standard mechanism behind
-- that behaviour.
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'guardian_locations'
    ) then
      alter publication supabase_realtime add table public.guardian_locations;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'sos_alerts'
    ) then
      alter publication supabase_realtime add table public.sos_alerts;
    end if;
  end if;
end $$;

-- ============================================================================
-- END OF BASELINE. This file documents the deployed state as of
-- 2026-11-01. It must never be re-applied to the live project.
-- Future changes: NEW timestamped migrations only, reviewed, and behind
-- the owner's Release Gate. See supabase/README.md.
-- ============================================================================
