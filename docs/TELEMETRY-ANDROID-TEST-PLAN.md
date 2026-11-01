# BASERA Telemetry — Android Device Test Plan (SMOKE backend only)

Status: **PREPARED, NOT EXECUTED.** No Android test has run yet.
Everything proven so far is local (PostgreSQL/Deno/jest) plus
HTTPS-level tests against the smoke project from a workstation.
This plan is the device gate that remains before any production
decision relies on on-device behavior.

## Hard boundaries

- Backend: the throwaway project `basera-telemetry-smoke`
  (ref `vwurzvvsfyimovauolrs`) ONLY. Production BASERA Supabase is
  never configured into the test build, never queried, never touched.
- No production OTA, no team distribution, no dashboard, no owner
  registration. The build used here is a throwaway, single-device
  artifact and is deleted after the run.
- The telemetry code under test is exactly the v7 client in this
  repository (commit pinned at execution time).

## Why a build is needed at all (and why it is gated)

The telemetry client ships inside the app bundle. The already
distributed APK 1.1.8 predates telemetry entirely, and pointing the
app at the smoke project requires build-time configuration
(`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
overrides for the smoke project). Therefore execution needs ONE
separate owner approval for ONE throwaway preview build. Until that
approval exists, this plan stays unexecuted — by design.

## Preparation (once approved)

1. Build a preview APK from the pinned commit with env overrides:
   - `EXPO_PUBLIC_SUPABASE_URL=https://vwurzvvsfyimovauolrs.supabase.co`
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<smoke publishable key>`
   (Both are public client values for a throwaway project; no
   production value is used anywhere in the build.)
2. Confirm the smoke project still holds the v7 schema + function
   (SQL delta + core.ts redeploy, as done 2026-11-01), and empty its
   two telemetry tables so counts start at zero.
3. Install the build on ONE Android test device (the owner's spare
   or the team test phone). No other device installs it.

## Steps and pass criteria

1. **First launch → server-issued identity.**
   Open the app once, with network. PASS: exactly ONE row appears in
   the smoke `app_installations`; its `first_seen_at`/`last_seen_at`
   are set; the app reports no error. FAIL if: more than one row, or
   none after a minute online.
2. **OTA lifecycle events land.**
   In the app's update screen, check for updates (the preview
   channel serves the published test update). Let it download; then
   fully close and relaunch the app. PASS: the smoke
   `app_update_events` shows `update_check`, `update_available`,
   `update_downloaded` for that installation, each exactly once,
   and — only after the relaunch — one `update_applied` whose
   `update_id` matches the downloaded update.
3. **Identity restoration across restart.**
   Force-stop the app, relaunch. PASS: still exactly ONE
   installation row; its `last_seen_at` advanced; NO new bootstrap
   (the row's `first_seen_at` is unchanged). This proves the
   SecureStore identity was restored, not re-issued.
4. **Offline queueing → delivery.**
   Enable airplane mode; trigger two update checks; disable
   airplane mode; wait for the next launch/flush. PASS: the queued
   events arrive at the smoke backend exactly once each (server
   dedupe visible: no duplicate rows despite any resend), and no
   event from the offline window is missing.
5. **Embedded-launch fact sanity.**
   PASS: the installation row's `is_embedded_launch` is a real
   boolean matching reality for the final running state (true while
   the embedded bundle runs before the update applies; the applied
   launch reports its update id). It is never a fabricated value:
   if the device state makes it unreadable, NULL is acceptable —
   a wrong boolean is not.
6. **Pool behavior sanity.**
   Across the whole run, PASS: the verdicts observed in the Edge
   Function logs show pool grants ONLY in response to sized
   requests, and repeated launches (heartbeats) grant 0 ids while
   the pool is healthy.

## Evidence to capture

- Smoke SQL snapshots: installation row count + the installation's
  event list (type, update_id, received_at) after steps 2, 3, 4.
- Edge Function log excerpts for the bootstrap and the flushes.
- A one-line verdict per step: PASS/FAIL + the observed values.
- Any failure stops the plan; the failure mode is reported, not
  worked around on the device.

## After the run

- Delete the throwaway build from the device.
- The smoke project may keep the test rows (it is disposable) or be
  emptied; it is never promoted to production.
- Results are reported separately from every local result: this
  plan, once executed, is the ONLY source of "works on Android"
  claims for telemetry.
