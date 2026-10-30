# OTA Lifecycle Audit — BASERA V1.1 (Phase 0 release gate)

Date: 2026-10-30. Scope: the update lifecycle of the 1.1.0 build
(`422c78b1`, runtime `1.1.0`, channel preview) after the OTA smoke update
(group `2f29ef5b-72b4-4154-9005-046e2740741c`) was published.

## 1. Flows that existed before this audit

Two independent check/download flows coexisted:

1. **Native auto flow (expo-updates).** `app.json` set
   `updates.checkAutomatically: "ON_LOAD"`, which prebuild wrote into the
   Android manifest as
   `expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH = ALWAYS`.
   On **every** app load the native layer checked the update server and
   downloaded any available update in the background, with no reference
   to the app's accessibility-busy state or the JS state machine.
2. **Manager flow (custom).** `src/update/UpdateService.ts` exposed
   `checkAndDownload()` (native `checkForUpdateAsync` +
   `fetchUpdateAsync`) driven from `src/app/updates.tsx`, with the
   safety contract that downloads never reload and application happens
   only via cold start or the guarded `restartToApply()`.
   A full call-site sweep (`grep` over `src/`) confirms the updates
   screen is the **only** caller of `UpdateService` methods and the only
   reader of update status; no component imports `expo-updates`
   directly outside the service (one comment mention in SpeechService).

## 2. Races identified

- **Duplicate downloads:** on a cold start with an update available, the
  native ON_LOAD flow and a user pressing "Check now" could run
  `fetchUpdateAsync` concurrently against the same update — duplicate
  network traffic and two writers racing the native update state.
- **Duplicate manager runs:** `checkAndDownload()` had no in-flight
  guard; two overlapping invocations (e.g. double-tap paths, screen
  re-entry) each invoked `checkForUpdateAsync`/`fetchUpdateAsync`.
- **Restart during download:** `restartToApply()` did not check whether
  a check/download was in flight; a reload mid-download could interrupt
  the fetch (the screen hid the button in that phase, but the service —
  the actual authority — did not enforce it).
- **Reload during accessibility work** was already refused via
  `isAccessibilityBusy()` and stays refused.

## 3. Resolution — one authoritative flow

**The custom `UpdateService` is the single authority** for every normal
check, download, and apply decision. The native auto behavior is reduced
to crash recovery only:

- `app.json`: `updates.checkAutomatically` changed
  `"ON_LOAD"` → `"ON_ERROR_RECOVERY"` (exact enum value verified in the
  installed package: `UpdatesCheckAutomaticallyValue.ON_ERROR_RECOVERY`
  in `node_modules/expo-updates/build/Updates.types.d.ts`).
- Native sync via `npx expo prebuild --platform android` (no `--clean`).
  The resulting android diff was **exactly one line**:
  `EXPO_UPDATES_CHECK_ON_LAUNCH`: `ALWAYS` → `ERROR_RECOVERY_ONLY`
  (the native value for this mode, per
  `expo/modules/updates/UpdatesConfiguration.kt` in the installed
  package). Nothing else in `android/` changed.

**Why ON_ERROR_RECOVERY is not a competing flow:** in the installed
Android implementation (`UpdatesUtils.shouldCheckForUpdateOnLaunch`),
`ERROR_RECOVERY_ONLY` returns `false` for launch checks — the native
layer performs **no** check on a normal launch. The only native check
that can still occur is inside the crash-recovery path: after repeated
crashes of a freshly loaded update, the controller can fetch a recovery
update/rollback instead of crash-looping. That path exists to keep the
app launchable; it never runs during ordinary use, never reloads a
healthy session, and cannot duplicate the manager's downloads in
practice because the manager only runs inside a healthy session.

**Concurrency hardening in `UpdateService`:**
- `checkAndDownload()` now stores a single `inFlight` promise;
  overlapping callers receive the same promise, so the native
  check/fetch pair runs **at most once** at a time. A call arriving
  while the phase is `downloading` joins the in-flight run instead of
  starting a second fetch.
- `restartToApply()` remains the only reload path and now refuses with
  reason `in-progress` while a check/download is in flight, in addition
  to the existing `busy` (accessibility operation running), `no-update`,
  and `unavailable` refusals.
- The updates screen renders status exclusively from
  `UpdateService.getStatus()` (single state machine: idle / checking /
  downloading / ready / error / unavailable).

**Tests added** (`src/update/__tests__/updateService.test.ts`, 14 total):
concurrent `checkAndDownload()` calls invoke the native
`checkForUpdateAsync` exactly once and share one fetch; a call during
`downloading` joins the in-flight run and the post-download status
reports the staged update id; `restartToApply()` during an in-flight
download refuses (`in-progress`) and succeeds after the download
settles; an fs-level test asserts app.json
`checkAutomatically === 'ON_ERROR_RECOVERY'`.

## 4. APK / OTA rollout note

`checkAutomatically` is baked into the **native manifest**, so this
change takes effect only in the **next APK build** (the next native
rebuild of runtime 1.1.0's successor). It cannot be delivered to the
already-built 1.1.0 APK (`422c78b1`) by an OTA update, because an OTA
bundle cannot change manifest meta-data. Until that rebuild, the 1.1.0
build keeps its ON_LOAD native behavior alongside the (post-OTA)
hardened manager — the duplicate-download race is mitigated by the
manager guard but the dual-flow configuration is fully resolved only in
the next APK. This is recorded honestly rather than claimed fixed
on-device.

## 5. On-device verification — NOT TESTED

Receipt and application of the published smoke update (group
`2f29ef5b-72b4-4154-9005-046e2740741c`, runtime `1.1.0`) on a physical
device has **not** been performed by the agent and is a TEAM device
check:

1. Install the 1.1.0 APK
   (https://expo.dev/artifacts/eas/dlg3b43qcODwHH-z8ObF7em3z7b9KGjsKT_L16Kdlns.apk)
   on a physical Android device with network access.
2. Open BASERA, go to **Settings → Updates**. Note the status, then
   press **Check now**; expect the phase to move
   checking → downloading → ready (no automatic restart at any point).
3. Press **Restart to apply** (or fully close and cold-start the app).
4. Reopen **Settings → Updates**: the release-notes section must show
   the smoke-test entry *"OTA smoke test — delivery channel verified"*
   (dated 2026-10-30) as the newest note — that note exists only in the
   OTA bundle, so its presence proves end-to-end receipt + application.
5. Also verify: starting a check while speech/recognition is active
   never restarts the app mid-operation.

Until those steps are run on hardware, the OTA lifecycle is verified at
code, contract-test, and server-targeting level only.
