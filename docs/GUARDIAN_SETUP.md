# BASERA Guardian — Owner Setup Checklist (V1.1 Phase 1)

Everything in Phase 1 is built so it **activates when this configuration
exists** and degrades honestly until then ("Guardian service is not
configured yet" — no fake data, no crash). Nothing below has been done
for you: the Supabase/Firebase projects are yours to create.

## 1. Create the Supabase project
1. supabase.com → New project (name: `basera`). Save the database password
   somewhere safe (not in this repo).
2. Project Settings → API: copy the **Project URL** and the **anon public**
   key. (The `service_role` key is used in step 5 only — never in the app,
   never in the PWA, never in git.)

## 2. Apply the migrations (in order)
Supabase Dashboard → SQL Editor → run each file fully, in this order:
1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_rls_and_functions.sql`
3. `supabase/migrations/0003_comments_and_cron.sql` (contains the pg_cron
4. `supabase/migrations/0004_saved_places.sql` — Smart Place Memory sync
   table. Owner-only RLS: guardians get NO access to saved places, by
   design. Skip it only if place sync will never be enabled.
   snippet for the 24-hour purge — enable the `pg_cron` extension under
   Database → Extensions and uncomment the schedule, **or** use the
   `cleanup-locations` Edge Function on an hourly schedule instead;
   one of the two is required for the 24 h retention guarantee)

## 3. Run the live RLS tests (release gate)
1. Dashboard → Authentication → Users: create three test users
   (`owner@test.local`, `guardian@test.local`, `stranger@test.local`).
2. In `supabase/tests/rls_tests.sql`, replace the three placeholder UUIDs
   with their real user ids.
3. Run the whole file in the SQL Editor. Success = the final row
   `ALL RLS TESTS PASSED` with PASS notices for the full denial matrix
   (anon/stranger/unlinked/pending/revoked all denied; active guardian
   allowed; sharing-off purge; 24 h cleanup).
   Until this passes on the live project, do not treat guardian access
   control as verified.

## 4. Configure the app
Set for EAS builds (eas env / `.env` — never commit real values):
```
EXPO_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
```
(or `extra.supabaseUrl` / `extra.supabaseAnonKey` in app.json — same effect)
Then build the 1.1.0 APK (preview channel). Without these, the guardian
screens show the not-configured state by design.

## 5. Deploy the Edge Functions + secrets
```
supabase functions deploy notify-guardian
supabase functions deploy cleanup-locations
supabase secrets set FCM_SERVICE_ACCOUNT_JSON='<firebase service account json>'
supabase secrets set FCM_PROJECT_ID='<firebase project id>'
supabase secrets set CRON_SECRET='<a long random string>'
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are
injected by Supabase automatically. **All privileged credentials exist
only here** (server side).

## 6. Firebase project (guardian web push)
1. console.firebase.google.com → create/open the project → add a **Web app**.
2. Project settings → Cloud Messaging: create a **Web Push certificate**
   (VAPID key pair). The public key goes in the PWA config; the private
   half stays in Firebase.
3. Project settings → Service accounts → Generate new private key → this
   JSON is `FCM_SERVICE_ACCOUNT_JSON` in step 5. Never commit it.

## 7. Deploy the guardian PWA
1. Edit `guardian-pwa/config.js`: `supabaseUrl`, `supabaseAnonKey`,
   `firebase` web config object, `vapidKey` (public).
2. Host the `guardian-pwa/` folder on any static **HTTPS** host.
3. Supabase Dashboard → Authentication → URL Configuration: add the PWA
   origin to Site URL / redirect allow-list.

## 8. OTA publishing procedure (EAS Update)
Prerequisite: the 1.1.0 APK (runtime 1.1.0) installed — the 1.0.0 APK has
no expo-updates module and can never receive OTA.
```
# 1) Add the release-notes entry FIRST (same commit as the code change):
#    edit src/update/releaseNotes.ts — the app displays notes from the
#    bundle itself; the --message text below is for humans/EAS only.
# 2) Publish a JS/assets-only update to preview:
eas update --channel preview --message "what changed"
# 3) Verify on a 1.1.0 preview device (updates screen shows the new
#    bundle id; it applies on cold start or via the safe restart button —
#    never mid-speech/processing).
# 4) Promote the EXACT tested update to production:
eas update:republish --destination-channel production
# 5) Rollback a bad update:
eas update:rollback --channel <channel>
```
**Code signing:** EAS Update code signing is **not** enabled by default
and is **not** configured in this project. It requires a paid/eligible
Expo plan + certificate setup (`eas update:configure` signing steps).
Verify eligibility on your Expo account before relying on it; treat it
as an optional hardening step, not a current guarantee.

**Native changes always need a new APK** (and a version bump → new
runtime): new native modules, permissions, SDK upgrades, config-plugin
changes. JS/TS/assets-only changes ship via OTA to the matching runtime.

## 8b. Privacy: offline revocation & server deletion (how it behaves)

Turning sharing off — or revoking the last guardian — does two separate
things, and the app reports them separately:

1. **Local (immediate, offline-safe):** collection and uploads stop at
   once; unsent points are discarded. The guardian screen states
   *"Sharing is OFF on this device — no new locations are recorded or
   sent."* This is always true the moment the toggle flips.
2. **Server (until acknowledged, it is only "pending"):** a deletion
   obligation is written to the device's secure storage **before** any
   network call (`basera.guardian.pendingDeletion.v1`), then the purge
   RPC (`set_sharing_enabled(false)`; for a last-guardian revoke, the
   `revoke_link` call is re-driven first) is attempted. Only when that
   RPC **succeeds** does the app say *"Server copies deleted —
   confirmed <date/time>"*. Any failure keeps the state at
   *"deletion pending"* and retries automatically on app launch, on
   returning to the foreground, when the guardian screen opens, or via
   the **Retry deletion now** button (retries are app-activity-driven —
   no background job is claimed). Turning sharing back on never cancels
   a pending deletion: it runs first on the next successful contact and
   removes the locations stored up to that moment.

Operators verifying privacy behavior on a live project: disable sharing
with the phone in airplane mode → the Table Editor still shows the rows
and the app shows *pending*; reconnect and reopen the app → the rows are
deleted and the app shows *confirmed* with a timestamp.

## 9. Acceptance checklist before calling Phase 1 "live"
- [ ] Migrations applied; live RLS script prints ALL RLS TESTS PASSED.
- [ ] 24 h purge active (pg_cron schedule OR cleanup-locations cron).
- [ ] Two phones: pairing code → pending → owner approves → guardian PWA
      shows the location; owner revokes → PWA access ends immediately;
      sharing off → server rows deleted (check in Table Editor).
- [ ] PWA push: register endpoint, send a `test` notification from the
      app account (notify-guardian), confirm the browser receives it.
- [ ] OTA: publish a trivial JS-only change to preview; 1.1.0 picks it
      up; 1.0.0 (no module) does not.
