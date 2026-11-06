# 02 — Expected Questions: UI/UX

**Q1. Why build a custom design system instead of styling each screen?**
Consistency is an accessibility feature: a blind user learns one pattern of
cards, rows, and buttons and reuses it everywhere. It also means a fix (like
the status-pill label length) lands in one place for all screens.

**Q2. How do you know the app is really usable with TalkBack?**
Every interactive element carries an accessibility label, results use live
regions, and there is an automated guard that the app never speaks
unprompted on entry. Full TalkBack-flow verification on hardware is stated
honestly as partially verified — we do not claim more than was tested.

**Q3. Why is the content capped at 600dp wide?**
On tablets and large phones, full-width text lines are hard to scan and
reach. A centered 600dp column keeps line length and reach consistent.

**Q4. Why default to the light theme?**
The fresh-install default was set to light after device feedback; the dark
and high-contrast themes remain one setting away, and the status bar is
theme-aware in both.

**Q5. How is Arabic handled beyond translation?**
Full RTL via `applyLayoutDirection`, Arabic string table with enforced key
parity, MSA-only UI copy guarded by tests that ban dialect terms, and
Arabic narration built for objects and directions (section 06).

**Q6. What are the label-length budgets for?**
Screen-reader users hear every label; long labels are slow and confusing.
`copy.test.ts` enforces max lengths for button labels and caps explanation
strings at two short sentences of fact.

**Q7. Why text glyphs instead of icon fonts or images?**
Glyphs render identically everywhere, scale with the type system, and pair
with text labels — an icon is never the only carrier of meaning.

**Q8. How do themes work technically?**
`SettingsContext` resolves preference (light/dark/system) plus a
high-contrast flag into a `ThemeColors` object via `colorsFor()`. All
components read colors from `useSettings()`, so one switch recolors the app.

**Q9. What happens on small screens or with large font settings?**
Type comes from one scale in `src/theme/tokens.ts`, cards are fluid, and
layout tests (`screenLayout.test.ts`) pin the structural rules.

**Q10. Did you test color contrast?**
Yes — `src/theme/__tests__/contrast.test.ts` checks the shipped palettes
programmatically, including the high-contrast variant.

**Q11. Why is the logo frozen?**
The official logo file is byte-identical by rule (`assets/brand/`) so the
brand the committee sees in the report, the app, and the archive is one
asset, never a regeneration.

**Q12. What UX mistake did you actually fix from device testing?**
Status pills were given full sentences; they ballooned and squeezed out
the text beside them, and the Family screen read like an article. Fixed
with short pill keys, two-sentence explainers, and feedback moved to the
top of the screen — shipped as an OTA update.
