# BASERA V1.1 — Final Premium Polish (2026-10-31)

Scope: refined iconography, uncluttered Home, canonical copy finish,
and an evidence-based functional audit. JS/assets only; runtime
`1.1.0`; dependencies byte-frozen; no native changes.

Commits: `048d32e` (stage 1) → `b581a2e` (stage 2) → visual-gate fixes.

## 1. Icon system spec

- One renderer: `Icon` (src/components/ui.tsx). A glyph renders ONLY
  through `Icon`, `IconTile` (now a borderless alias of `Icon`),
  `StatusPill`, or as a small inline symbol inside a button label.
- Sizes come only from the `iconSize` tokens (src/theme/tokens.ts):
  `sm 16 / md 20 / lg 24 / control 32`. Weight is 500 (never 800).
  Color is the text color, the secondary text color, the single
  accent, or a semantic tone's solid color — **no filled tile, no
  soft container, no shadow** behind an icon, anywhere.
- Where a control needs a boundary (segmented control, compact
  actions), the boundary belongs to the CONTROL (hairline border /
  track), never to the icon.
- Touch targets unchanged: rows ≥72dp, hero 80dp, tabs ≥58dp items —
  the visible glyph is small; the target is the row.
- Controls exception: the voice microphone disc and similar control
  surfaces may keep a large circular SURFACE (the whole surface is
  the tap target); the glyph inside is capped at 32dp and the fill
  became a soft surface with the state color on ring + glyph.
- Regression guard: `src/components/__tests__/iconography.test.ts`
  statically scans src/app + src/components and fails on any glyph
  fontSize >32, any literal fontSize >26 outside the whitelist
  (family pairing-code digits = content; voice disc glyph ≤32;
  BrandMark letterform = logotype), and on the old `size * 0.46`
  filled-tile scaling ever returning.

### Glyph audit (outline swaps)

Filled/heavy forms swapped for outline equivalents that read light
at 16–24dp in Roboto/Noto; each feature keeps a UNIQUE glyph:

| Slot | Before | After | Why |
|---|---|---|---|
| assistance | ◆ | ◇ | filled diamond → outline |
| sos | ⚑ | ⚐ | filled flag → outline flag |
| family | ♥ | ♡ | solid heart → outline heart |
| notifications | ✦ | ✧ | filled star → outline star |
| places transport | ➤ | ▸ | heavy arrowhead → light triangle |

Kept after audit (already light or conventionally outlined at small
sizes): ◉ voice (thin ring + small core), ◎ detect, ≣ read, ⌖ places,
⚠ alerts, ▤ history, ⚙ settings, ⌂ home, ↻ updates, ✓/✕/ℹ status,
◌ glasses/empty, ▦ gallery/sample (inline at caption size only),
⬢ shield / ⛨ privacy (distinct pair, small inline use), ★ favorite
(state symbol, inline), place-category set (✚ hospital kept — the
medical cross is a meaning, not decoration).

`BrandMark` is the product logotype, not an icon: header size is now
28dp, and the accent "eye" dot renders only at ≥40dp (at 28dp it
muddled into the letterform's own dot — caught in visual QA).

## 2. Home — before / after

Before: 44dp brand mark, 30px greeting, a 96dp hero with a 60dp
white disc + 30px glyph, a 2×2 grid of tiles each carrying a 48dp
filled icon tile, two status strips with 40dp filled tiles, and a
paragraph service-note banner at the bottom.

After (exact mandated order, nothing else):
1. Compact brand header — 28dp mark + wordmark + tagline.
2. Greeting as page title (24px): «ما الذي تحتاج إليه؟».
3. Voice hero — typography-led filled primary, 80dp, 24dp mic icon,
   state line under the label. No disc.
4. Feature navigation — detect / read / places / alerts as QUIET
   LIST ROWS (hairline-separated, 24dp outline icon, title, one-line
   subtitle, 20dp chevron). No tiles, no grid.
5. Glasses status strip — one line, «النظارة غير متصلة» pill.
6. Family strip — the REAL sharing state as its pill.
7. Active high-alert banner (when present) + last result with
   Repeat. The bottom service-note banner was removed: the family
   strip already carries the unconfigured state, and the full note
   lives on the Family screen (smoke-test expectation updated for
   exactly this mandated composition change — the only expectation
   change in stage 1; stage 2A changed none).

## 3. Per-screen changes (icon pass)

- **Tabs**: icons already 20–24dp outline glyphs; bar height 70→78
  so Arabic labels never crowd the bottom edge (visual-QA fix).
- **Assistance**: composed of hero + quiet rows + speech actions —
  all glyphs now route through the primitives (24dp max).
- **Voice**: disc = restrained ring + soft surface, glyph 56→32 in
  the state color; header title is now «المساعدة الصوتية».
- **Detect / Read**: preview placeholder glyph 44→24dp muted `Icon`;
  viewfinder + slim source bar unchanged in behavior.
- **Places**: misleading `size={46}` prop dropped (IconTile is
  borderless now); favorite ★ moved out of the title string into a
  small standalone `Icon` beside the title.
- **Alerts**: severity glyph bypassed the primitives at type-size —
  now `Icon` 20dp in the severity tone.
- **Family / Settings**: audited — every glyph already via
  primitives; pairing-code digits are content (left at 40px).
- **History / Updates / Guardian-auth / Onboarding /
  ImageSourcePicker / MyLocationCard / LocationMapPreview /
  QrCodeView**: swept; already clean or adjusted above (BrandMark
  84→64 onboarding, 44→36 guardian-auth).

## 4. Copy — canonical finish

- `detect` AR: «وصف ما حولك» → «وصف المشهد»; `places` AR:
  «الأماكن المحفوظة» → «أماكني المحفوظة»; new key `voiceAssistance`
  = «المساعدة الصوتية» / 'Voice assistance', applied at the root
  stack voice header and the onboarding feature row (noun-title
  spots). `voice` stays «المساعد الصوتي» (persona) and
  `startVoiceAssistant` stays the action label.
- Spoken-command parser phrases were NOT renamed (recognition
  aliases ≠ UI labels); parser tests pass unchanged.
- Slogan sweep: `repeatExpl` and `hapticsExpl` cut to one sentence
  each; consent/safety explanations deliberately kept (their second
  sentences are material facts, within the enforced budgets).
- `copy.test.ts` now asserts all seven canonical strings exactly.

## 5. Functional audit — findings

### Defects found, fixed, regression-tested

1. **SpeechService busy-guard leak** (`src/ai/SpeechService.ts`).
   The speech accessibility-busy flag (the OTA restart safety
   guard's input) was cleared only by TTS callbacks; `stop()` never
   released it and a synchronous `Speech.speak` throw leaked it
   forever — after either, every OTA restart would be refused
   permanently. Fix: the utterance's clear-callback is stored and
   invoked by `stop()` (idempotent) and on speak failure.
   Tests: 2 new in `speechService.test.ts` (both failed pre-fix).
2. **Voice adapter session leaks** (`src/ai/VoiceCommandService.ts`).
   `startListening` was not idempotent (double start re-registered
   listeners and re-called native start), result handlers were not
   finished-guarded (a duplicate final result delivered `onResult`
   twice), and a native `start()` throw left four live
   subscriptions. Fix: session flag, finished-guards everywhere,
   try/catch → clear subscriptions + rethrow (retry works).
   Tests: 4 new in `voiceAdapter.test.ts` (3 failed pre-fix).
3. **LocationSharingService concurrent-start race**
   (`src/guardian/LocationSharingService.ts`). `running` flipped
   only after several awaits, so two concurrent `start()` calls
   would both subscribe a location watch and double-enable sharing.
   Fix: concurrent callers share one in-flight start promise and
   its real result. Test: 1 new (one watch, one enable call).

### Audited clean (evidence in code + existing tests)

- **UpdateService**: the only reload path refuses on
  unavailable / in-progress / no-update / accessibility-busy;
  concurrent checks dedupe onto one promise; 14 tests incl. the
  app.json ON_ERROR_RECOVERY audit. (Finding 1 was the real hole
  in this chain — the guard existed but its input could stick.)
- **Settings**: all ~26 controls mapped control → handler → real
  persisted state/service effect. **Zero dead controls.** (The
  background-location row deliberately routes to Family, where the
  grant flow lives; the voice picker honestly renders only when
  the OS returns voices.)
- **Family**: all controls real, incl. purge-first sign-out,
  offline-safe last-guardian revocation, SOS with honest outcome.
- **Guardian/location**: sharing transitions, PendingDeletion
  state machine (confirmed only on RPC success), background-stop —
  covered by 7 test files, all passing.
- **Places**: CRUD, Arabic-normalized search, distance honesty
  (rounded meters only ≤50m accuracy), proximity cooldown — tested.
- **Hazards**: vibration call sites present in high/medium/SOS
  paths behind the haptics gate; RiskEngine persistence/cooldown/
  escalation and acknowledgment — tested.
- **Listener cleanup** (all 13 screens + shared components):
  voice (unmount + blur stop), updates (unsubscribe + interval
  cleared), detect/read (runId + busy finally), places/alerts/
  assistance/history (focus-effect reads only), MyLocationCard
  (one-shot reads, in-flight ref). No leaks found.

### Report-only gaps (no defect proven; no behavior changed)

- No combined test asserts vibration fires inside
  `processHazardDetections` (patterns/gate are tested in
  `haptics.test.ts`; call sites verified by code read).

## 6. Performance notes

No re-render or blocking-work defects were found in the audit scope
beyond the session/listener issues fixed above: list rows in
History/Places were already memoized in the overhaul pass; camera/
OCR/voice/location work is guarded by busy flags + run ids and
never blocks navigation; press feedback remains opacity-only and
is fully disabled under reduced motion. No new transitions added.

## 7. Visual gate — verdicts (RENDERED-WEB previews)

Method: `expo export --platform web`, served locally, captured with
Playwright + Firefox at 390×844 @2x, settings seeded through the
app's own persisted-settings key. **These are web previews, not
Android screenshots.** Known preview artifacts: (a) Arabic previews
compose flex rows in LTR order — on device, `I18nManager.forceRTL`
applies at cold start and mirrors them (text itself is Arabic and
correctly aligned here); (b) web has no safe-area inset, so the tab
bar sits flush to the viewport edge.

Files in `~/workspace/your_files/basera-redesign/` (`*-v3-*`):
home (AR dark, EN light), assistance, voice, detect, read, places,
family, alerts (AR dark, EN light), settings (AR dark, EN light),
history, updates — 14 renders, each personally inspected.

- Home AR/EN — PASS. Compact header, calm rows, small outline
  icons, one filled primary. (QA fixes applied + re-rendered:
  brand-dot muddle at 28dp; Arabic tab-label crowding.)
- Voice — PASS. Ring control with 32dp glyph reads as a control,
  not decoration; «المساعدة الصوتية» header live.
- Assistance — PASS. Same quiet row language as Home.
- Detect / Read — PASS. Viewfinder-first, 24dp placeholder, slim
  source bar, honest glasses pill.
- Places — PASS. Category segments carry small glyphs; the
  selected segment wraps full-width (pre-existing segmented flex
  behavior, acceptable).
- Family — PASS. Honest unconfigured states; nothing faked.
- Alerts — PASS. Limitation banner first; outline SOS flag;
  24dp empty-state glyph.
- Settings AR/EN — PASS. Quiet groups, 20dp section icons.
- History — PASS. Clean empty state.
- Updates — PASS. The new release note renders.

No screen contains oversized decorative icons, filled icon tiles,
or paragraph-stacked cards. Device rendering (TalkBack order, real
GPS/tile loads, small handsets) remains a team device task — not
claimed here.

## 8. Gates (final tree)

- Jest: **27 suites / 392 tests, all passing** (baseline 379 +
  4 iconography guard + 8 stage-2B + 1 sharing-race).
- Guardian PWA: **18/18**. TypeScript clean. Lint exit 0.
- `git diff` vs pre-polish HEAD for package.json / package-lock /
  android/ / app.json / eas.json: **0 lines**.
- Android export: models byte-identical (yolo `19bfdc3c…`,
  ppocr_det `04e8e0b6…`, ppocr_arabic_rec `1fc31af5…`).
- Release-notes entry added (2026-10-31, runtime 1.1.0).

## 9. Publish

EXPO_TOKEN is not present in the agent shell (verified), so the
publish is scripted and ready: `~/workspace/.scratch-basera/publish-v7.sh`
— fresh Android export, then up to 14 alternating-route
`eas update --skip-bundler` attempts on preview, then update:list
verification. Run it with EXPO_TOKEN set. Expected: a new group
newer than `19db3608`, runtime 1.1.0, commit = final polish HEAD.
