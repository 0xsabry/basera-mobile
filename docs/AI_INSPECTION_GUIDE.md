# AI inspection guide for BASERA

This document is the operating brief for any AI assistant, coding agent, reviewer, or teammate asked to inspect BASERA, explain how it works, investigate a bug, prepare a report, or create presentation materials.

## 1. Establish exactly what is being inspected

Before analysis:

1. Identify the repository, current branch, and exact HEAD commit.
2. Confirm the working tree/branch being inspected is the intended one. Do not silently switch branches.
3. Read README.md, docs/PROJECT_OVERVIEW.md, docs/FEATURE_STATUS.md, docs/ARCHITECTURE.md, and docs/README.md.
4. For the feature being discussed, inspect its current implementation and tests. Do not rely only on documentation or commit messages.
5. Read the applicable deployed contract before making backend claims:
   - Guardian backend: docs/SUPABASE_INTEGRATION.md and supabase/README.md.
   - Guardian Edge Functions: supabase/functions/README.md.
   - Release and OTA: docs/RELEASE.md and scripts/release-guard.mjs.
   - Models: docs/MODELS.md and scripts/verify_model.py.
   - Telemetry: docs/TELEMETRY.md plus the current deployment state described there.

The documentation can become stale. Source code and the deployed contract should be checked before presenting a claim as current.

## 2. Evidence vocabulary — use these labels precisely

| Label | What it proves | What it does not prove |
|---|---|---|
| Code implemented | The implementation exists in the inspected branch | That it works end-to-end |
| Unit-tested | An automated test covers the relevant logic and passed in the stated run | Native module behaviour or real-world accuracy |
| Host-verified | A model or pipeline was run on a development computer using recorded inputs | Android CPU, memory, heat, audio, camera, or device behaviour |
| Export/build verified | Expo export or a named native build completed | The APK is installed, launched, or usable on a physical phone |
| Device-tested | The exact physical device, OS/app version, steps, and observed result are recorded | Other phones or all real-world conditions |
| Backend-verified | The exact deployed project, endpoint/table/policy, test identity, and result are recorded | Undocumented future backend changes |
| Published | A specific EAS update/build or backend deployment is confirmed by provider output | That a user device received or applied it |
| Applied on device | The running installed build/update identity confirms the update was applied | That every team member has the same version |

Never convert one evidence type into another. For example, host model inference is not on-device inference; a passing parser test is not microphone recognition; a successful push-token registration is not push delivery.

## 3. Current implementation truths

- Object detection: YOLO11n TFLite; do not call it YOLOv8n.
- Arabic OCR: PP-OCRv3 detection plus Arabic recognition TFLite.
- Latin OCR: Google ML Kit with explicit Latin script. ML Kit Arabic OCR is not used.
- TTS: expo-speech and the device's installed TTS voices. KemeTone is not integrated.
- Voice recognition: expo-speech-recognition uses the platform recognition service; parser tests are separate from device recognition tests.
- Guardian backend: deployed contract in SUPABASE_INTEGRATION.md wins over archived local SQL design.
- Guardian pairing becomes active immediately on acceptance; the deployed contract has no pending approval stage.
- Location records are latest-only in the deployed backend, not a GPS history trail.
- Browser push is not registered with the deployed backend.
- Camera hazard checks run on user-captured frames; they are not continuous.
- Camera hazard events remain local because the deployed schema has no hazard-events table or notify-guardian function.
- SOS has a different path: local recording plus a remote row only when the user is signed in and consent permits it.
- Smart glasses are future hardware; the current source is a typed unavailable placeholder.
- Distance/proximity warnings are heuristic unless a real depth sensor is specified and integrated.
- Smart Place cloud sync references saved_places, but that table is not established by the current deployed backend contract. Mark it unverified.
- Telemetry source, telemetry function, and dashboard hosting/owner readiness are separate facts. Do not say the dashboard is live merely because HTML exists.

## 4. Safe automated verification

Use the lockfile and repository scripts. From a fresh checkout, the normal static checks are:

~~~bash
npm ci
npx tsc --noEmit
npm run lint
npx jest --runInBand
npm run test:pwa
npx expo export --platform android
~~~

Model verification may require Python dependencies and downloaded upstream artifacts. Read MODELS.md and the script requirements first. Do not claim the model checks ran unless the actual command and result are available.

After running tests, report:
- branch and HEAD commit;
- exact commands;
- pass/fail counts and exit codes;
- environment and platform;
- skipped tests and why;
- whether a real Android device or only a host environment was used.

The counts in TESTING.md are dated historical snapshots unless a run explicitly names the current HEAD.

## 5. Hardware and live-backend verification

Native modules in this project require an appropriate development/standalone Android build. Expo Go or a successful web export is not a substitute.

A device report must name:
- physical phone model and Android version;
- installed app version, versionCode, runtime, and channel where available;
- APK or build identifier;
- input sample and exact actions;
- visible result, audio result where relevant, and error log;
- network state for any claimed offline test.

A backend report must name:
- the project reference (never reveal passwords or secret keys);
- the deployed object/function actually checked;
- the authenticated role used;
- the operation and response;
- the RLS/consent case tested;
- date and whether the test used production or a disposable project.

Do not create fake test evidence, fake screenshots, fake recordings, or invented measurements.

## 6. Supabase and production safety rules

These are hard constraints:

- Never apply archived migrations 0001–0004 or any archived local-design functions to the live project.
- Never replay the baseline deployed-state migration.
- Treat 20261101000000_telemetry_proposal.sql as a distinct telemetry change, not as a general setup script. Confirm its current applied/migration-history state before any CLI migration command.
- Do not run supabase db push, migration repair, SQL writes, schema changes, Edge Function deployments, auth-setting changes, or production data mutations without explicit owner approval for that exact operation.
- Never add a service-role key, database password, EAS token, GitHub token, or other secret to Git.
- A Supabase publishable key is a public client credential, but that does not make server credentials safe to publish.
- Do not create a new Supabase project or change the connected production project.

Read supabase/README.md before any Supabase work.

## 7. EAS, APK, and OTA safety rules

- Do not build or publish merely because a documentation task is underway.
- Do not publish to production.
- Do not publish a preview OTA or create an APK without the owner's explicit request.
- Before any authorized release, run the appropriate release guard: ota before an OTA, apk before an APK.
- Native code/config/dependency changes may require a new APK; do not assume an OTA can deliver them.
- A published update group is not proof that a phone applied it. Follow docs/RELEASE.md acceptance checks.
- Do not change app.json, Android Gradle version stamps, runtimeVersion, channels, signing, or EAS profiles during documentation cleanup.

## 8. How to prepare a project explanation or university presentation

Use docs/TEAM_PRESENTATION_GUIDE.md as the starting outline, but inspect the current source code for every technical claim.

A strong explanation should cover:
1. The user problem and product goals.
2. The user's journey through the mobile application.
3. The architecture and why Expo/React Native/TypeScript are used.
4. How image input reaches YOLO and the OCR engines.
5. How detections and recognized text become spoken feedback.
6. How voice commands, local history, and Smart Place Memory work.
7. How hazard alerts and SOS differ.
8. How Supabase Auth, PostgreSQL, RLS, Edge Functions, and the Guardian PWA fit together.
9. What automated tests and model verification actually prove.
10. Current limits and future smart-glasses integration.

Do not claim every teammate wrote every module. Map people to work only when the team confirms the real contribution.

## 9. Expected inspection report format

For a repository audit, return:

- Inspected repository, branch, commit, and date.
- Executive summary.
- Architecture and data-flow explanation.
- Feature inventory with evidence labels.
- Tests actually run and results.
- Confirmed bugs, documentation conflicts, and security risks, with file paths.
- Unverified assumptions and device/backend tests still required.
- Recommended changes separated into documentation, application code, and production operations.

For a presentation task, return a slide-by-slide outline and speaker notes, identify which source files support each slide, and flag any statement that must be phrased as planned or unverified.