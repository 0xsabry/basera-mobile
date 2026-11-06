# 06 — Source Map: Voice System

## Speech output

| Path | Key exports | Role |
|---|---|---|
| `src/ai/SpeechService.ts` | `SpeechService` (interface), `ExpoSpeechService`, `speechService` (singleton) | All speech goes through here: speak, announcements, stop/interruption, `setVoicePreference()`, `warmUp()`; tracks whether speech is active so an idle `stop()` round-trip is skipped |
| `src/ai/voiceCatalog.ts` | `VoicePreference` (`auto` / `system` / `custom`), `selectEgyptianVoice()`, `resolveVoiceIdentifier()`, `normalizeVoiceLanguage()` | Voice discovery + Egyptian selection: **exact** normalized `ar-EG` match only, best quality tier first |
| `src/ai/voiceSingleton.ts` | Shared instance wiring | One speech service for the whole app |
| `src/app/settings-voice.tsx` | Voice settings screen | Automatic / System / custom voice rows (from the live device voice list) |
| `src/state/SettingsContext.tsx` | `Settings.voicePreference`, `migrateVoicePreference()` | Persists the preference; migrates legacy stored values |

## Narration

| Path | Role |
|---|---|
| `src/ai/DescriptionBuilder.ts` | Detections → spoken sentences; Egyptian-style direction phrases («على شمالك» / «قدامك» / «على يمينك», opener «شايف:») for narration only — never applied to OCR text |
| `src/ai/ObstacleAwareness.ts` | `horizontalPosition()`, `proximityCategory()`, `analyzeObstacles()` — the position/proximity words narration uses |

## Speech input (voice commands)

| Path | Key exports | Role |
|---|---|---|
| `src/ai/VoiceCommandService.ts` | `COMMAND_REGISTRY`, `parseVoiceCommand()`, `CommandAction`, `VoiceUnavailableError`, `VoiceRecognitionError` | Recognized speech → one of a fixed set of app commands (AR + EN phrases) |
| `src/app/voice.tsx` | Voice commands screen | Push-to-talk flow, honest recognizer errors |

## Latency work (2026-11)

| Path | Role |
|---|---|
| `src/ai/warmUp.ts` | `startLatencyWarmUps()` — starts voice discovery + YOLO load at app startup |
| `src/ai/SpeechService.ts` | Cold-cache Arabic `auto` utterances race discovery against **300 ms**, then speak with the `ar-EG` language fallback; the discovered voice applies from the next utterance |
| `src/ai/__tests__/speechLatency.test.ts` | The three latency contracts (bounded wait, idle stop-skip, warm-up speaks nothing) |

## Tests

`speechService.test.ts`, `speechServiceVoice.test.ts` (first utterance uses
the discovered Egyptian voice when discovery answers fast),
`voiceCatalog.test.ts`, `voiceAdapter.test.ts`, `voiceCommands.test.ts`,
`speechLatency.test.ts`, plus `src/app/__tests__/noEntrySpeech.test.ts`
(nothing speaks on app entry).
