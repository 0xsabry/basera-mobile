# 09 — Source Map: History & Settings

## History

| Path | Key exports | Role |
|---|---|---|
| `src/data/HistoryStore.ts` | `HistoryStore`, `historyStore`, `HistoryItem`, `HistoryStorage`, `MAX_HISTORY_ITEMS = 50`, `persistImageCopy()` | Newest-first list over AsyncStorage; images copied into app-private storage so entries do not die with the picker's temp files |
| `src/app/(tabs)/history.tsx` | History tab | List, replay (re-speak), remove, clear |
| `src/hazards/AlertHistoryStore.ts` | Alert history | The hazard-alert sibling store (section 07), shown in `src/app/alerts.tsx` |

### Data flow — saving a result

detect/read flow → `historyStore.add({...})` (id + timestamp assigned by
the store, list capped at 50) → image persisted via `persistImageCopy()`
→ History tab reads `historyStore.list()` → replay speaks the stored
description through `SpeechService`.

## Settings

| Path | Key exports | Role |
|---|---|---|
| `src/state/SettingsContext.tsx` | `Settings` (interface), `DEFAULT_SETTINGS`, `parseSettings()`, `migrateVoicePreference()`, `SettingsProvider`, `useSettings()`, `ThemePreference` | The one settings model + persistence + migration of legacy stored shapes |
| `src/app/(tabs)/settings.tsx` | Settings tab | Language, theme, contrast, announcements, links to voice + updates |
| `src/app/settings-voice.tsx` | Voice settings | Voice preference editing (section 06) |
| `src/state/languageRestart.ts` | Language switch flow | Applies a new language + RTL without a broken intermediate state |
| `src/state/haptics.ts` | Haptic feedback | Confirmation feedback for actions |
| `src/state/accessibilityBusy.ts` | Busy state for assistive tech | Announces long operations |

### Settings fields (from the `Settings` interface)

language · theme preference · high contrast · announcements ·
voice preference · guardian sharing enabled · background sharing enabled.

Guardian *consent* itself is server-side per guardian link (section 10) —
the local flags only say whether this device collects/uploads at all.

## Storage rules

- Settings + history: AsyncStorage (plain device storage).
- Secrets (telemetry identity): SecureStore only — settings storage never
  holds credentials; the guardian session is Supabase Auth's own storage.
- Corrupt stored settings fall back to `DEFAULT_SETTINGS` via
  `parseSettings()` instead of crashing.

## Tests

`src/data/__tests__/history.test.ts`, `src/state/__tests__/settings.test.ts`,
`languageRestart.test.ts`, `haptics.test.ts`, `accessibilityBusy.test.ts`.
