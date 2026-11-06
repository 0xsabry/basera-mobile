# 06 — Voice System

**Duration: 2 minutes**

## Scope

- Speech output: `SpeechService` over the device TTS (expo-speech), with a
  voice-preference model — Automatic (Egyptian selection), System default,
  or a specific device voice.
- Egyptian voice selection: exact `ar-EG` device voices only; locale
  metadata alone is never treated as proof of Egyptian pronunciation.
- Narration building: detections → natural spoken Arabic/English
  (`DescriptionBuilder` + obstacle positions).
- Speech input: voice commands (`VoiceCommandService`, a fixed command
  registry parsed from recognized speech).
- Recent performance work: bounded voice discovery, idle stop-skip, startup
  warm-up — the "voice takes time to speak" fix.

## Explicit non-claim

The genuine Egyptian **neural** voice (KemeTone) is an external prototype
that is **not integrated** into this app. What ships is system TTS with
Egyptian voice *selection*. Present it exactly that way.

## Shared documentation

- [Feature status](../../docs/FEATURE_STATUS.md)
- [Architecture](../../docs/ARCHITECTURE.md)

## Files in this folder

`SOURCE_MAP.md`, `CODE_WALKTHROUGH.md`, `PRESENTATION.md`, `DEMO_GUIDE.md`,
`EXPECTED_QUESTIONS.md`.
