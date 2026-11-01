# Installations & OTA Adoption Telemetry — design and rollout

Owner-facing system to answer two questions truthfully: how many real
installs run BASERA, and which devices actually APPLIED each OTA update
(downloaded is not applied).

## Feasibility verdict (checked 2026-11-01)

**Fully implementable as a JavaScript-only OTA update. No new APK, no
native change, no runtime/package/signer change.**

- Every dependency already ships inside APK 1.1.8: `expo-updates`
  (~58.0.19), `expo-secure-store`, `@react-native-async-storage`,
  `expo-constants`, and the app's own `readInstalledVersion`.
- The expo-updates JS surface was verified against the INSTALLED SDK
  type definitions (`Updates.updateId`, `Updates.isEmbeddedLaunch`,
  `Updates.channel`, `Updates.runtimeVersion`, check/fetch result
  unions) — the same discipline that fixed the 1.1.7 updater bug.
- **`expo-observe` is NOT in APK 1.1.8** (zero entries/references in the
  APK). Per the owner's rule it is not being added: a native library
  must not be introduced just for a metric. What Expo alone cannot
  provide anyway: a per-device adoption registry. EAS shows update
  groups and publish metadata, not which anonymous device applied
  which update — that is exactly what this telemetry adds.

## Architecture

```
App (JS, via OTA)
  src/telemetry/telemetry.ts   identity, queue, applied-detection
  src/telemetry/index.ts       real wiring (SecureStore, fetch, facts)
  src/update/UpdateService.ts  optional telemetry sink at the
                               check/available/downloaded/failed seams
        │  HTTPS POST (publishable key + per-install secret header)
        ▼
Supabase Edge Function  telemetry-ingest  (ONLY writer; service role
        │                                  stays server-side)
        ▼
Tables  app_installations / app_update_events  (RLS on, no client
        │                                       policies at all)
        ▼
RPCs    dashboard_overview / dashboard_adoption /
        dashboard_installations  (SECURITY DEFINER + owner allowlist)
        ▼
Dashboard  telemetry-dashboard/index.html  (owner email/password
           login; the page alone grants nothing — RPCs refuse
           non-owners server-side)
```

### Identity & privacy
- Installation ID: random UUID v4 at first launch, persisted in
  SecureStore (fallback AsyncStorage). A random per-install secret
  authenticates the device's own reports; only its SHA-256 hash is
  stored server-side; the first request pins it.
- Anonymous by design: no account/user link, no IMEI, no location, no
  contacts, no hardware IDs. Facts recorded: platform, OS version,
  app version + build, runtime, channel, running update id.
- Deduplication: installations by primary key; events by a unique
  client-generated event id (retries/replays are idempotent).

### Downloaded vs Applied
- `update_downloaded` fires when the bundle is staged.
- `update_applied` fires only at a LATER launch whose running update
  (`Updates.updateId` / `isEmbeddedLaunch`) matches the staged one —
  i.e. the device provably restarted onto the new bundle. A transition
  detected without our download path (native recovery / server
  rollback) is also recorded as applied for the update actually
  running, never for the staged one.
- Heartbeat: every flush carries the installation facts, so the same
  call registers the first launch and refreshes `last_seen_at` later.

### Offline
Events persist in a capped local queue (200). Flush is attempted at
launch, after each update event, and on init; a failed flush leaves
the queue intact for the next attempt.

### Measurement trust limits (honest bounds)
- Counts are trustworthy for honest, unmodified clients.
- Installations are anonymous and self-registered by design, so a
  person running a modified/rooted build can register extra fake
  installations or forge events for their OWN installation id (it is
  bound to their installation secret). The server bounds this with a
  request-size cap, batch cap, strict field validation and a
  per-installation hourly event budget, but the system does NOT claim
  to be tamper-proof against the owner of a modified device.
- Uninstall + reinstall creates a NEW installation (standard industry
  semantics): "installations" means reported active installs, not
  people. Adoption ratios between funnel stages (discovered →
  downloaded → applied) are the robust signal for update health.
- `last_seen_at` means "the app last contacted the telemetry
  endpoint", stamped server-side; client timestamps are sanity-checked
  and never used for ordering.

## Rollout (each step gated by the owner)

1. **Approve the migration** `supabase/migrations/20261101000000_telemetry_proposal.sql`
   (proposal file; NOT applied). Apply it to project
   `vbvvwyeccsegfwprwrga` only after approval.
2. Register the owner: insert the owner's Supabase Auth user id into
   `dashboard_owners` (one SQL line, in the migration header).
3. Deploy the `telemetry-ingest` Edge Function (dashboard or CLI).
4. Host `telemetry-dashboard/index.html` on Cloudflare Pages (owner
   decision: the dashboard is NOT served from a Supabase Edge Function
   on the default domain). One-time setup needs the owner's Cloudflare
   login in the browser; the result is a stable `*.pages.dev` link.
   The page ships only the publishable key; every data read stays
   behind Supabase Auth + the owner-gated RPCs.
5. Publish the client via the manual preview OTA workflow
   (owner-approved publish, acceptance gate as usual).
6. One-device test on the owner's phone, then verify the dashboard.

## Acceptance mapping

| Criterion | Proven by |
|---|---|
| First install recorded once | Jest: identity created once & reused; server PK + secret pinning |
| No duplicate per open | Same ID across launches; events unique by client_event_id |
| OTA arrival detected | update_check / update_available / update_downloaded events |
| Downloaded != Applied | Jest: applied fires only at the launch running the staged update, exactly once |
| Running version shown truthfully | Facts come from Updates.updateId / isEmbeddedLaunch + expo-application |
| Offline safety | Jest: queue persists through failed flushes, same event ids delivered later |
| Unauthorized access denied | RLS with no client policies; RPCs raise for non-owners (verified with anon + non-owner sessions in the live harness after deployment) |
