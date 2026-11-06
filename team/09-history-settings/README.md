# 09 — History & Settings

**Duration: 2 minutes**

## Scope

- History: every detection/reading result can be saved on-device (max 50,
  newest first), with its image copied into app-private storage so entries
  survive; the History tab replays results and their spoken descriptions.
- Settings: one typed settings model — language, theme (light/dark/system),
  high contrast, announcements, voice preference, and the guardian sharing
  flags — persisted on-device and consumed through one context.
- Data flows: how a result becomes a history item, how a setting change
  propagates (theme recolors instantly, language flips RTL and restarts
  safely), and what is *not* stored anywhere.

## Out of scope

Guardian account data (that lives in Supabase — section 10) and the
telemetry envelope (section 03). Everything here is local persistence.

## Shared documentation

- [Feature status](../../docs/FEATURE_STATUS.md)
- [Copy standard](../../docs/COPY.md)

## Files in this folder

`SOURCE_MAP.md`, `CODE_WALKTHROUGH.md`, `PRESENTATION.md`, `DEMO_GUIDE.md`,
`EXPECTED_QUESTIONS.md`.
