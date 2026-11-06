# 03 — Expected Questions: Expo & Mobile Development

**Q1. Why Expo instead of plain React Native or native Android?**
One TypeScript codebase, managed build/signing (EAS), and OTA updates.
For an accessibility app whose fixes must reach users fast, OTA alone
justifies it. We still keep the bare workflow, so native control is not
given up.

**Q2. What is the runtime version and why does it matter?**
Ours is the manual string `"1.1.0"` in `app.json`. An OTA update only
installs on apps with the same runtime version — it is the compatibility
contract between a JS update and a native build. Native changes require
a new APK and a new runtime.

**Q3. How do OTA updates reach the phone, step by step?**
The app asks the Expo Updates protocol endpoint for its channel
(preview) with its runtime version; the server returns a manifest plus
per-asset authorization; the app downloads the bundle and assets,
verifies hashes, and applies on restart. Our acceptance gate replays
exactly this as a real client before we call a publish delivered.

**Q4. What actually broke in your update system once?**
The client read `isUpdateAvailable`; SDK 58 returns `isAvailable` — so
updates silently never appeared in builds 1.1.0–1.1.6. Found by auditing
the shipped bundles, fixed in 1.1.7, and now guarded by a compile-time
SDK-shape assertion and contract tests.

**Q5. Preview vs production channels — why two?**
Preview is where every fix is proven; production is untouched without
explicit approval. The release guard fails a publish if channel
separation or the version ladder is violated.

**Q6. Where does the version number come from?**
For Android, from `android/app/build.gradle` (versionName 1.1.8,
versionCode 10). In a bare-workflow project EAS ignores the app.json
version fields for this — a documented trap in `docs/RELEASE.md`.

**Q7. How are permissions handled?**
Requested in context (location only when sharing is turned on, camera
inside the labelled test flow, microphone in voice commands), each
preceded by an in-app explanation on the onboarding and feature screens.
Denial paths are handled and spoken, not dead ends.

**Q8. What starts when the app launches?**
Providers (settings, language), the update service, telemetry sink
wiring, and latency warm-ups: TTS voice enumeration and YOLO model load
in the background, producing no sound or UI.

**Q9. How do you roll back a bad update?**
Republish the previous known-good group to the channel (bookkeeping in
`docs/RELEASE.md` always names the current group and the rollback
target), then re-run the acceptance gate.

**Q10. Is the telemetry a privacy problem?**
It is anonymous by design: server-issued installation identity, no user
account linkage, no location or content — only update-lifecycle events.
Identity secrets live in SecureStore; the design is documented in
`docs/TELEMETRY.md`.

**Q11. Why TypeScript?**
The guardian and update contracts are exactly where silent shape errors
hurt (see Q4). Types plus contract tests caught real defects before
runtime.

**Q12. What is EAS?**
Expo Application Services: cloud builds with managed keystores, the
workflow runner we use for preview APKs and OTA publishes, and the
updates CDN/protocol the app talks to.
