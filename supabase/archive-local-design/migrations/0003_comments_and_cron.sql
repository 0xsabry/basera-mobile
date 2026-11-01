-- BASERA V1.1 Phase 1 — 0003: documentation comments + scheduled purge.
-- The 24-hour retention purge runs through ONE of these (owner enables):
--   (a) pg_cron, below — preferred when the extension is available, or
--   (b) the cleanup-locations Edge Function on an external schedule
--       (see docs/GUARDIAN_SETUP.md).

comment on table public.profiles is
  'One row per auth user. display_name is the only field a link party may read.';
comment on table public.guardian_links is
  'Owner<->guardian relationship. Location access exists only while status = active. Transitions happen only through approve_link / revoke_link / redeem_pairing_code.';
comment on table public.pairing_codes is
  'SHA-256 hashes of one-time pairing codes. 15-minute expiry, single-use, raw code never stored.';
comment on table public.location_points is
  'Detailed GPS history. Retained at most 24 hours (cleanup_locations). Deleted immediately when sharing is disabled.';
comment on table public.latest_locations is
  'Last known location per user, kept only while sharing is active. Written only by the sync_latest_location trigger.';
comment on table public.hazard_events is
  'Phase 3 table (schema ready in Phase 1; no app writes yet).';
comment on table public.push_endpoints is
  'Separately registered push endpoints per platform: android-expo (Expo token) and web-fcm (FCM Web Push token). Sending is Edge-Function-only with server-side credentials.';

-- (a) pg_cron schedule — uncomment after enabling the pg_cron extension
-- in the Supabase dashboard (Database -> Extensions -> pg_cron):
--
-- select cron.schedule(
--   'basera-purge-old-locations',
--   '17 * * * *',
--   $$ select public.cleanup_locations(); $$
-- );
