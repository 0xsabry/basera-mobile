# BASERA Guardian — Owner Setup Checklist

> **Status (updated 2026-10-31): the owner's Supabase project EXISTS
> and is DEPLOYED, and both clients are wired to it.**
> Project: `https://vbvvwyeccsegfwprwrga.supabase.co` (publishable
> key in app config + `guardian-pwa/config.js`). Pairing (Edge
> Functions), per-link consent, latest location, SOS and Realtime are
> live-verified — see `docs/SUPABASE_INTEGRATION.md` for the deployed
> contract **as discovered**, which DIFFERS from the local design this
> checklist originally described. **Do NOT run steps 2 or 4 below**:
> the migrations and functions in `supabase/` were never applied to
> the deployed project and are archived history only. Remaining owner
> items: host the Guardian PWA (step 7's hosting part) if not already
> done; push *delivery* is untested (only token registration is
> implemented); SOS rows and auth accounts cannot be deleted by
> clients (owner Dashboard actions).

Complete the steps in order.

## 1. Create the Supabase project

- [ ] Go to supabase.com → **New project** (suggested name: `basera`).
      Save the database password somewhere safe (not in this repo).
- [ ] Project Settings → API: copy the **Project URL** and the
      **anon public** key — you will need them in steps 7 and 8.
      The `service_role` key is server-only: never put it in the app,
      the PWA, `config.js`, or git.

## 2. ~~Run the migrations 0001 → 0004, in order~~ — SUPERSEDED, DO NOT RUN

The deployed project uses the owner's own schema (see
`docs/SUPABASE_INTEGRATION.md`). The files below are the archived
local design only.

Supabase Dashboard → SQL Editor → run each file fully, in this exact
order (or use the Supabase CLI: `supabase db push`):

- [ ] `supabase/migrations/0001_schema.sql`
- [ ] `supabase/migrations/0002_rls_and_functions.sql`
- [ ] `supabase/migrations/0003_comments_and_cron.sql`
- [ ] `supabase/migrations/0004_saved_places.sql`

Do not skip or reorder them. `0004_saved_places.sql` is owner-only by
design (guardians get no access to saved places).

## 3. Configure Auth

- [ ] Supabase Dashboard → Authentication → Providers: **enable the
      Email provider** (the Guardian PWA signs in with email + password).
- [ ] Authentication → URL Configuration: set the **Site URL** to the
      Guardian PWA’s HTTPS origin (from step 7) and add that same
      origin to the **Redirect URLs** allow-list.

## 4. ~~Deploy the Edge Functions and set their secrets~~ — SUPERSEDED

The deployed project runs the owner's `create-guardian-invite` /
`accept-guardian-invite` functions instead. The functions below are
the archived local design only.

The functions on disk in `supabase/functions/` are exactly:

- `notify-guardian` (`supabase/functions/notify-guardian/index.ts`)
- `cleanup-locations` (`supabase/functions/cleanup-locations/index.ts`)

- [ ] Deploy both:

  ```bash
  supabase functions deploy notify-guardian
  supabase functions deploy cleanup-locations
  ```

- [ ] Set the secrets (server-side only, never committed):

  ```bash
  # For notify-guardian — Firebase service account (see step 6):
  supabase secrets set FCM_SERVICE_ACCOUNT_JSON='<firebase service account json>'
  supabase secrets set FCM_PROJECT_ID='<firebase project id>'

  # For cleanup-locations — a long random string you choose:
  supabase secrets set CRON_SECRET='<a long random string>'
  ```

  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
  `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically.

## 5. Schedule the 24-hour cleanup

Detailed location history must be purged after 24 hours. Choose
**one** of these — one of them is required:

- [ ] **Option A — pg_cron (in `0003`):** Supabase Dashboard →
      Database → Extensions → enable `pg_cron`, then uncomment the
      `cron.schedule(...)` block in
      `supabase/migrations/0003_comments_and_cron.sql` and run it
      (it schedules `select public.cleanup_locations();`).
- [ ] **Option B — external cron:** schedule an hourly HTTP call to
      the `cleanup-locations` Edge Function with the header
      `x-cron-secret: <CRON_SECRET>` (the value from step 4).

## 6. Create the Firebase web app + VAPID key (web push)

Push is optional: **you may leave `firebase` as `null` in
`config.js` and the PWA works fully without push notifications.**

- [ ] console.firebase.google.com → create/open the project →
      add a **Web app** and copy its Firebase web config object
      (used in step 7).
- [ ] Project settings → Cloud Messaging → **Web Push certificates**:
      generate a key pair. The **public key** is the VAPID key for
      step 7; the private half stays in Firebase.
- [ ] Project settings → Service accounts → **Generate new private
      key**: this JSON is `FCM_SERVICE_ACCOUNT_JSON` in step 4.
      Never commit it.

## 7. Host the Guardian PWA and fill in `config.js`

- [ ] Edit `guardian-pwa/config.js`:
  - `supabaseUrl` — the Project URL from step 1.
  - `supabaseAnonKey` — the anon public key from step 1.
  - `firebase` — the Firebase web config object from step 6,
    **or `null`** to run without push.
  - `vapidKey` — the Web Push certificate public key from step 6
    (leave empty if `firebase` is `null`).
  - Map tiles — leave the defaults unless you run your own tile
    host: `mapTileUrl`
    (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`),
    `mapAttribution`, `mapMaxZoom` (`19`). Public OSM tiles are
    best-effort with no SLA.
- [ ] Host the whole `guardian-pwa/` folder on any static **HTTPS**
      host.
- [ ] Go back to step 3 and make sure this exact HTTPS origin is in
      the Supabase Auth Site URL / Redirect URLs.

## 8. Configure the app side and publish a preview OTA

The app reads its Supabase settings from EAS environment variables.
The values are **inlined at publish time**, so changing them requires
a new OTA publish (or a new build) to take effect.

- [ ] Set the **preview** environment variables in EAS:

  ```bash
  eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://<your-project>.supabase.co
  eas env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon public key>
  ```

  (Use the Project URL and anon public key from step 1.)

- [ ] Publish a new preview OTA:

  ```bash
  eas update --channel preview --message "Guardian: Supabase configured"
  ```

- [ ] Until this step is done, the app honestly shows **“not
      configured”** on the guardian screens — that is expected, not a
      bug. After the OTA, verify on a 1.1.0 preview install (runtime
      `1.1.0`): the 1.0.0 APK has no expo-updates module and can never
      receive OTA.

## Done criteria

- [ ] Migrations 0001–0004 applied, in order, with no errors.
- [ ] 24-hour cleanup scheduled (step 5, Option A **or** B).
- [ ] Guardian PWA hosted on HTTPS, `config.js` filled in, and its
      origin allow-listed in Supabase Auth (step 3).
- [ ] Preview OTA published with the two `EXPO_PUBLIC_*` variables
      set (step 8), and the app no longer shows “not configured”.
- [ ] End-to-end check: pairing code → owner approves in the app →
      guardian PWA shows the location; owner turns sharing off →
      the latest-location row is deleted and the PWA shows sharing
      as paused / no signal.
