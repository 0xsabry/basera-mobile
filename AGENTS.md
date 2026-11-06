# AGENTS.md — BASERA repository instructions

You are inspecting or modifying BASERA, an Android-first Arabic/English accessibility assistant.

## Read first

1. README.md
2. docs/PROJECT_OVERVIEW.md
3. docs/FEATURE_STATUS.md
4. docs/ARCHITECTURE.md
5. docs/PROJECT_FILE_MAP.md and docs/FEATURE_IMPLEMENTATION_MAP.md (locate the real implementation before explaining or changing it)
6. docs/IMPLEMENTATION_AND_DEPLOYMENT_STATUS.md (candidate vs deployed vs device-verified — never blur)
7. docs/AI_INSPECTION_GUIDE.md
8. docs/README.md

Then inspect the source files and tests related to the task. For backend work, read docs/SUPABASE_INTEGRATION.md, supabase/README.md, and supabase/functions/README.md first. For releases, read docs/RELEASE.md and scripts/release-guard.mjs.

## Truth and evidence rules

- Identify the current branch and HEAD commit before analysis.
- Source code and current deployed-contract docs outrank stale plans and old commit messages.
- Label each claim as implemented, unit-tested, host-verified, export/build-verified, device-tested, backend-verified, published, or applied on device as appropriate.
- Do not turn an automated test into a claim of Android end-to-end success.
- YOLO11n is the current object detector. Arabic OCR uses PP-OCR. ML Kit is Latin-only.
- TTS is expo-speech with device voices. KemeTone is not integrated.
- Smart glasses are future hardware, not a working input source.
- Hazard scanning is user-triggered on captured frames, not continuous. Proximity is heuristic, not measured distance.
- Guardian deployed pairing is immediate on acceptance; there is no approval stage. Consent is per-link and starts disabled. Location rows are latest-only.
- Camera hazard records have no deployed remote event destination. Browser push is not connected to the deployed backend.
- Smart Place cloud sync references a table not established by the current deployed Supabase contract; treat it as unverified.
- Do not claim the telemetry dashboard is ready because its HTML exists.

## Safety rules

- Never add credentials, tokens, passwords, service-role keys, or other secrets to Git.
- Never apply archived local-design migrations 0001–0004 or archived functions to production.
- Never replay the baseline deployed-state migration.
- Do not run db push, migration repair, production SQL writes, schema/RLS changes, Edge Function deployment, auth changes, or production data changes without explicit owner approval.
- Do not create or deploy a new Supabase project.
- Do not build an APK or publish an OTA, especially production, without explicit owner approval.
- Do not change app.json, Android Gradle versions, runtimeVersion, EAS profiles, signing, or channels during a documentation-only task.

## Verification

Use npm ci, TypeScript, lint, Jest, PWA tests, and Expo export as appropriate. Record exact commands, environment, branch, commit, counts, and failures. Device-only native features require physical-device evidence. See docs/AI_INSPECTION_GUIDE.md.

## Change discipline

Make the smallest task-scoped change. Preserve user data and production behaviour. Do not refactor unrelated modules. Update the canonical documentation if implementation changes. Do not call a feature complete when any required test or deployment gate remains open.