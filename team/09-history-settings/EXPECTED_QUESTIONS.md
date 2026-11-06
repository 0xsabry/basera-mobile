# 09 — Expected Questions: History & Settings

**Q1. Why cap history at 50 items?**
Bounded storage and a list a screen-reader user can actually traverse.
Newest-first with automatic eviction keeps the most relevant results;
the number is one constant (`MAX_HISTORY_ITEMS`) if it ever changes.

**Q2. Why copy the image into app storage?**
Picker/camera URIs point at temp or shared locations the OS can clean
or revoke. `persistImageCopy()` gives each history entry an image the
app owns, so a saved result never becomes a broken thumbnail.

**Q3. What happens if stored settings are corrupted?**
`parseSettings()` validates and falls back to `DEFAULT_SETTINGS`. The
app opens with sane defaults instead of crashing — important for users
who cannot see a crash dialog.

**Q4. How do settings reach every screen?**
A single `SettingsProvider` + `useSettings()` hook. Theme colors,
language, and flags are read from the same context, so one change
propagates everywhere, including the status bar.

**Q5. How does the language switch work, including RTL?**
The new language is persisted, `applyLayoutDirection()` flips the
layout direction, and a controlled restart applies it cleanly. All UI
text comes from the string table — a test fails the build if a screen
hardcodes text.

**Q6. What is migrated in `migrateVoicePreference` and why?**
Older builds stored the voice choice in a simpler shape. The migration
upgrades stored values to the current `VoicePreference` union so users
keep their choice across updates instead of being silently reset.

**Q7. Are passwords or tokens in settings storage?**
No. Settings storage holds preferences only. The telemetry identity
secret lives in SecureStore, and the guardian session is managed by
Supabase Auth. Mixing secrets into AsyncStorage would be a security
defect.

**Q8. Is history uploaded anywhere?**
No. History is device-local. Detection images and descriptions never
leave the phone through the history feature. (Guardian location
sharing is a separate, consented flow — section 10.)

**Q9. How is history tested?**
Store tests with an in-memory `HistoryStorage` fake: add/list order,
the 50-cap eviction, remove/clear, corrupt-JSON fallback — see
`history.test.ts`.

**Q10. Can the user turn off spoken announcements?**
Yes — the `announcements` setting gates optional spoken confirmations.
Core results and hazard alerts follow their own rules; the setting is
for chattiness, not for silencing safety.

**Q11. Why AsyncStorage and not SQLite?**
The data is small, document-shaped (one JSON list, one settings
object), and read whole. SQLite would add a native dependency for no
measurable benefit at this scale.

**Q12. What is stored for a history item exactly?**
The result payload (type, description/labels or recognized text,
timestamp) plus the persisted image copy path — enough to replay the
experience faithfully without the original source.
