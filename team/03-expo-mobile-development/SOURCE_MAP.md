# 03 — Source Map: Expo & Mobile Development

## Configuration

| Path | Contents |
|---|---|
| `app.json` | Expo config: scheme `basera`, version `1.1.8`, `runtimeVersion: "1.1.0"` (manual string), EAS project ID `f402737d-1b54-441d-8738-99ce8e9009e9`, updates URL `https://u.expo.dev/f402737d-…`, Supabase public config in `extra`, iOS usage descriptions |
| `eas.json` | Build profiles: `development`, `preview` (APK, internal distribution, channel `preview`), `production` (channel `production`), `telemetry-smoke` (channel `telemetry-smoke`) |
| `android/app/build.gradle` | The native source of truth for versionName `1.1.8` / versionCode `10` (bare workflow: EAS reads versions from Gradle, not app.json) |
| `package.json` | Dependencies + scripts (`test`, `lint`, typecheck via `tsc`) |

## Startup and lifecycle

| Path | Role |
|---|---|
| `src/app/_layout.tsx` | Root: settings + i18n providers, telemetry sink wiring, update service, `startLatencyWarmUps()` on mount |
| `src/ai/warmUp.ts` | `startLatencyWarmUps()` — voice discovery + YOLO model prewarm; produces no speech or UI |
| `src/state/languageRestart.ts` | Safe language switching |
| `src/state/navGuard.ts` | Blocks navigation away from in-progress flows |

## OTA updates

| Path | Role |
|---|---|
| `src/update/UpdateService.ts` | `updateService`: check/fetch/apply over expo-updates; typed results (`UpdateCheckResult`, `UpdateFetchResult`, `UpdateStatus`, `UpdatePhase`); a compile-time `ExpectTrue` guard pins the facade to the real SDK shape |
| `src/update/releaseNotes.ts` | `RELEASE_NOTES` — in-bundle, versioned release notes (the `eas update --message` text is not reliably readable by the app, so notes ship in the bundle) |
| `src/app/updates.tsx` | The in-app Updates screen (check, download, restart) |
| `scripts/release-guard.mjs` | `node scripts/release-guard.mjs ota\|apk` — verifies runtime version, channel separation, version ladder, and native-input drift before any publish |
| `.eas/workflows/publish-preview-ota.yml` | Manual workflow: dry-run export check, then publish to preview (input `publish`, default false) |
| `.eas/workflows/build-preview-apk.yml` | Manual preview APK build |
| `.eas/workflows/build-telemetry-smoke-apk.yml`, `publish-telemetry-smoke-ota.yml` | Isolated telemetry smoke line (never preview) |

## Anonymous update telemetry (platform-level, no user identity)

| Path | Role |
|---|---|
| `src/telemetry/telemetry.ts` | Event queue + atomic state envelope (AsyncStorage), identity in SecureStore only |
| `src/telemetry/config.ts` | `resolveSupabaseConfig` — canonical config resolution |
| `src/telemetry/index.ts` | Public seam; UpdateService reports through `setTelemetrySink` |

## Permissions

Declared in `app.json` / Android manifest and requested in context:
camera (labelled test input), microphone (voice commands), location
foreground + background (Guardian sharing, section 08). Onboarding
(`src/app/onboarding.tsx`) explains before the system prompts.

## Tests

`src/update/__tests__/updateService.test.ts`, `updateContract.test.ts`,
`appVersion.test.ts`; `src/telemetry/__tests__/*.test.ts`;
`src/app/__tests__/noEntrySpeech.test.ts`.
