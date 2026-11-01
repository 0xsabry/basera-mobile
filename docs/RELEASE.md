# BASERA Release Runbook

Rules that govern every APK build and OTA publish. Owner's standing orders:
**no automatic publishes — every publish/build happens only on the owner's
explicit request; never publish to production unless the owner orders it;
an uploaded OTA is not a working update until it is verified running.**

## Fleet inventory (verified 2026-11-01 from the actual APK files)

All builds share package `me.auramarketing.basera` and the SAME signing
certificate (SHA-256 `3fcc089d3aa1790f0ad2b8084f2bfbe7fdee7e148de8a64619c0eb7b228a63d4…`),
so Android upgrades any of them in place (no uninstall, data preserved)
when the new versionCode is higher.

| Version | Code | Runtime | Channel | OTA capable |
|---|---|---|---|---|
| 1.0.0 (MVP) | 1 | — | — | No — no expo-updates at all |
| 1.1.0 | 2 | 1.1.0 | preview | Broken updater (never applies OTA) |
| 1.1.1 | 3 | 1.1.0 | preview | Broken updater |
| 1.1.2 | 4 | 1.1.0 | preview | Broken updater |
| 1.1.3 | 5 | 1.1.0 | preview | Broken updater — sent to the whole team 2026-10-31 |
| 1.1.4 | 6 | 1.1.0 | preview | Broken updater — link also sent to the team |
| 1.1.5 | 7 | 1.1.0 | preview | Broken updater |
| 1.1.6 | 8 | 1.1.0 | preview | Broken updater |
| 1.1.7 | 9 | 1.1.0 | preview | **Fixed updater — OTA device-proven 2026-11-01** |
| 1.1.8 | 10 | 1.1.0 | preview | Fixed updater (this release) |

"Broken updater" = the pre-1.1.7 `isUpdateAvailable` field bug: those apps
check but never apply an OTA. Any device on code ≤ 8 can only be rescued by
an APK install-over (this release). Which exact version each team member
runs cannot be proven from here; the fleet may be mixed — code 10 upgrades
every one of them.

## Channels

- `preview` profile → channel `preview` (the team fleet). `production`
  profile → channel `production` (unused; never publish without an
  explicit owner order). Development profile has no update channel.
- runtimeVersion is the manual string `"1.1.0"` (bare workflow). It may
  only change when native inputs change (see guard), never casually.

## Before any publish or build

1. Run `node scripts/release-guard.mjs` — it must PASS (runtime, channel
   separation, version ladder, native-drift vs the last APK commit).
2. If the guard reports native-input changes, ship an APK — never an OTA.
3. OTA publishes happen only through the manual EAS Workflow
   `publish-preview-ota.yml` with `publish=true`, on the owner's request.

## After any OTA publish — acceptance gate (all required)

1. Protocol request as a real client (headers: expo-protocol-version 1,
   expo-platform android, expo-runtime-version, expo-channel-name,
   expo-embedded-update-id of the target APK) — the server must serve the
   NEW update, not the previous one.
2. Download the bundle and ALL assets using the authorization headers
   from the response's extensions part; verify EVERY content hash.
3. Verify content identity (marker census / asset hashes), not just the
   existence of an update group.
4. One real device applies it and the app runs (owner's phone first)
   before calling it delivered.

## Rollback

- Previous stable update group on preview: `23926c22-b702-4211-9f62-a3cb941bd2c7`
  (2026-11-01 test update, device-proven). Before it: `18ec1185-00bb-4860-9312-ab9c1ca607fd`.
- Republish a known-good group to preview with
  `eas update:republish --destination-channel preview` (dashboard/CLI,
  owner-approved), or roll clients back to the embedded bundle via the
  update workflow's rollback support. Verify with the acceptance gate
  after any rollback, exactly like a publish.

## After shipping a new APK

Update `LAST_APK_COMMIT` / `LAST_APK_CODE` in `scripts/release-guard.mjs`
and the fleet table above.
