# BASERA V1.1 — Product Quality Overhaul (2026-10-31)

Scope: design identity, professional AR/EN microcopy, and a real
map-based GPS/guardian experience. JS/assets only — runtime stays
`1.1.0`, no native changes, no dependency changes (the only
`package.json` diff vs the redesign commit `9b9ef6c` is one added
script line, `test:pwa`; dependencies/devDependencies/overrides are
byte-identical, `package-lock.json` untouched, and
`android/`, `app.json`, `eas.json` have zero diff).

Commits (branch `v1.1`): `1a80f15` PWA · `5480f87` copy · `d18e7b3`
verbatim-expectation copy fixes · `bdc6b93` GPS app · `efec43e` design
· `da215ea` release notes · `dedbf7c` visual-QA fixes.

## Workstream A — Design identity (before → after)

Diagnosis of the redesign build: every surface used the same radius
(24), the same elevation and a 1px border, so Card / FeatureTile /
ListRow were indistinguishable; decorative per-tile tones made color
meaningless; Home stacked header + hero + two fat cards + a 6-tile
grid; Settings was a stack of bordered cards (admin-dashboard feel);
on Family, management blocks preceded the actual status.

After:
- **Tokens**: radius hierarchy (hero 24 / card 16 / row 14 / pill),
  elevation discipline — cards are flat (border only); `raised` and
  `hero` elevation are reserved for the single hero-adjacent surface
  per screen. No color values changed → the WCAG contrast contract is
  untouched.
- **Brand**: BrandMark is now distinctive — the letter «ب» in a
  squircle with a thin accent ring and the letter's dot rendered in
  the accent color below it (an "eye" nod). AppHeader slimmed;
  the greeting is the display element, the date a quiet caption.
- **Glyphs**: a unique glyph per primary feature (assistance ◆,
  SOS ⚑, history ▤, voice ◉, detect ◎, read ≣, places ⌖, alerts ⚠,
  family ♥, settings ⚙) — previously assistance==SOS and
  history==repeat.
- **New primitives**: `QuietGroup` (hairline-divider lists, no card
  box), `StatusStrip` (one-row status: 40dp tile + title + pill),
  `TimelineRow` (date rail), quiet `ListRow` variant; SegmentedControl
  sits in a quiet track (selected = filled + ✓, accessibility
  semantics unchanged).
- **Color discipline**: one accent (primary) for primary actions;
  semantic tones only for real status. Home grid tiles are all
  primary-toned now.
- **Per-screen composition**: Home = slim header → voice hero →
  glasses StatusStrip (one line + pill, no paragraph) → 2×2 grid
  (describe, read, places, alerts — in that order) → family
  StatusStrip → contextual alert banner / last result → service note.
  Assistance = hero + quiet action rows + speech-control group +
  permission rows + SOS danger strip. Detect/Read = viewfinder-first
  with a slim source control bar (camera is the single filled
  action). Voice = one 132dp focal disc (idle/listening/error by tone
  + text) + quiet transcript/commands. History = timeline.
  Settings = QuietGroups (only account + About remain cards).
  Family = status-first (My Location → sharing status → account →
  consent → privacy → background → SOS → pairing → requests →
  guardians). Alerts = the "not continuous protection" limitation is
  now the first element on the screen.

## Workstream B — Microcopy (see docs/COPY.md for the full log)

All 332 keys rewritten (313 kept, 0 deleted, 19 added for My
Location/map). Arabic is now professional MSA interface-wide: the
dialect markers (لسه، عايز، دوس، مش-negation, هـ-futures, دلوقتي)
are gone and this is enforced by tests. Owner examples applied
verbatim: tagline «المساعدة الذكية» / "Smart assistance", greeting
«ما الذي تحتاج إليه؟» / "What do you need?", glasses status
«النظارة غير متصلة» (compact, details off Home). A factual error was
fixed: `guardianLocationNote` falsely claimed background tracking is
"not in this version" — it is, and the note now says so briefly.
Buttons are 1–3 words; descriptions are one short sentence (two at
most for consent/safety explanations, test-enforced budgets);
errors = problem + next action; spoken strings short (hazard speech
remains prefix + label + direction + proximity, e.g.
«احذر! سيارة — يسار — يبدو قريب»). Terminology is fixed in
docs/COPY.md (وصف ما حولك / قراءة النص / الأماكن المحفوظة / الوصي /
مشاركة الموقع / استغاثة / النظارة) and spot-checked by tests.
Note: the example phrases in the Voice screen's supported-commands
list («ايه اللي قدامي؟») are *user-speech examples* the parser
accepts — intentionally colloquial, not interface labels.

Copy tests (`src/i18n/__tests__/copy.test.ts`, 10 tests): AR/EN key
parity + non-empty, label length budgets (AR ≤28 / EN ≤32 chars over
42 label keys), forbidden dialect/false-claim scans over every value,
terminology spot checks, explanation-length budgets.

## Workstream C — GPS / Guardian map

Concepts stay separate: (A) phone GPS acquisition, (B) sharing +
sync, (C) guardian map (PWA), (D) Saved Places (untouched).

### (A) Phone GPS — audited, found complete
`LocationSharingService` (Balanced, 30 s/25 m watch, batching,
AppState foreground-only guarantee, offline flush, PendingDeletion
purge), `BackgroundLocationService` (60 s/50 m, deferred 500 m/5 min,
separate explained opt-in, refuses without permission),
`OfflineLocationQueue` (FIFO, capped), `sharingState` (pure state
derivation), `places/currentFix` (typed permission/unavailable
errors, never fabricates). No gaps required fixes; no `console.*`
exists in `src/guardian` or `src/places`, so coordinates cannot leak
to logs.

### (A+) NEW — My Location (Family tab, works with no server)
`src/components/MyLocationCard.tsx` + `LocationMapPreview.tsx`,
backed by two new pure modules:
- `src/guardian/locationStatus.ts` — fix-age classification
  (fresh ≤ 3 min / stale), accuracy quality (good ≤ 50 m / poor /
  unknown), and the My Location state machine
  (locating → services-off → permission-denied → no-fix →
  fresh/stale) with the precedence above.
- `src/guardian/tileMath.ts` + `mapConfig.ts` — slippy-map math
  (only viewport-intersecting tiles; x wraps, y clamps) and the
  single tile config: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`,
  zoom 16, attribution `© OpenStreetMap contributors`.
The card reads services/permission silently on focus (never prompts),
shows state, accuracy (m), qualitative fix age, the phone-source
label, the sharing pill, and — only with a real fix — the tile
preview with a marker derived from that fix (fresh = filled dot;
stale = hollow dashed dot + age label). Refresh is the only
prompting action. Tile failure falls back to the details-only view.
The preview works fully while Supabase is unconfigured.

**OSM tile-policy compliance** (https://operations.osmfoundation.org/policies/tiles/):
HTTPS only; viewport tiles only (no bulk, no prefetch, no offline
tiles); explicit `User-Agent: BASERA/1.1 (me.auramarketing.basera)`
header because generic library UAs are blocked; no cache-defeating
headers (RN Image/okhttp honors standard caching); attribution is
always rendered and never hidden. Public OSM tiles are best-effort
with **no availability guarantee** — the provider URL is a single
config constant in both the app (`mapConfig.ts`) and the PWA
(`config.js`) so a managed provider (e.g. MapTiler/Stadia) can be
substituted when volume requires, after checking its terms.

### (B)+(C) Guardian PWA — brought to spec
`guardian-pwa/`: tile URL/attribution/maxZoom now come from
`config.js`; the map shows marker **+ accuracy circle**; profiles
are read with `sharing_enabled`, so the state line distinguishes —
via the new pure classifier (`guardian-pwa/freshness.js`, UMD,
18 node tests wired as `npm run test:pwa`): **updated-recently**
(≤2 min) / **last-known** (≤15 min) / **stale** / **no-signal**
(sharing on, no fix received) / **sharing-paused**
(`sharing_enabled=false`; note the `latest_locations` row itself is
purged server-side when sharing stops) / **no-internet** (offline or
fetch failure). 30 s polling + manual refresh kept; no marker is
ever rendered without a real latest row; service worker bumped to
v2 and still never caches cross-origin (API/tile) traffic; no
Referrer-Policy is set anywhere. The phone-side-only states
(permission-denied, GPS-off, sync-pending) are surfaced in the app
itself by `deriveSharingState` / the My Location card, which is
where those signals exist.

### Supabase status — NOT CONFIGURED (owner action required)
Verified: `app.json` extra has no Supabase values, the EAS preview
environment was empty at last authenticated check, and
`guardian-pwa/config.js` ships empty. Remote guardian tracking is
therefore honestly shown as "not configured" in both clients.
Exact owner checklist is in `docs/GUARDIAN_SETUP.md`: create the
Supabase project → run migrations `0001`→`0004` in order → enable
email auth + whitelist the PWA origin → deploy Edge Functions
`notify-guardian` + `cleanup-locations` with secrets
`FCM_SERVICE_ACCOUNT_JSON`, `FCM_PROJECT_ID`, `CRON_SECRET` →
schedule the 24 h cleanup (pg_cron or external cron) → optional
Firebase web app + VAPID for push → host `guardian-pwa/` on HTTPS
and fill `config.js` → set EAS preview env
`EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` and
publish a fresh preview OTA (values inline at publish time).
Local GPS, the in-app preview, Saved Places and the PWA map code do
not depend on any of this. Privacy unchanged: sharing defaults OFF,
approved guardians only (RLS), no public links, 24 h retention,
revocation purges (PendingDeletion flow preserved).

### GPS working-status table
| Capability | Status |
|---|---|
| Foreground phone GPS fix (accuracy + timestamp) | Implemented + unit-tested; device check pending |
| Foreground sharing watch + batching + offline queue | Implemented + tested (prior phases) |
| Background tracking (installed native capability) | Implemented + tested; device check pending |
| My Location view + OSM tile preview | **New** — implemented + unit-tested; tile rendering is device/network check pending |
| Guardian PWA map (Leaflet + OSM, accuracy circle, states) | **Upgraded** — code complete + classifier tested (18/18) |
| Remote guardian tracking end-to-end | **NOT CONFIGURED** — owner Supabase setup required (above) |
| Two-device guardian visibility test | Not possible until configured |

## Workstream D — Home + alerts wording
Covered above: Home follows the mandated priority order with
compact glasses status; alert speech is level + direction +
proximity only; SOS and guardian-delivery outcomes keep their
honest wording (including "your guardians were NOT notified");
the scan-based limitation leads the Alerts screen.

## Visual QA (coordinator, on the rendered screenshots)
First render pass caught three real defects, all fixed in `dedbf7c`
and re-verified by re-rendering:
1. The glasses status pill overflowed its strip off-screen
   (EN label, and Arabic at text scale 1.3) → pills now compress
   and wrap inside the strip.
2. The Home 2×2 grid silently stacked full-width (48% basis + 16dp
   gap > 100%) → 46% basis; the grid now forms.
3. Tab labels overlapped at text scale 1.3 → capped at 17px.
At 1.3 the first Arabic tab label sits tight against the screen
edge in the web render; on-device spacing is a checklist item.

## Screenshots — RENDERED-WEB, not device
Exported web build in headless Firefox (Playwright) at 390×844 @2x
with the app's settings key seeded; inspected by the coordinator.
`~/workspace/your_files/basera-redesign/`: `home-v2-ar-dark.png`,
`home-v2-en-light.png`, `home-v2-ar-dark-xl.png` (text scale 1.3),
`assistance-v2-ar-dark.png`, `voice-v2-ar-dark.png`,
`family-v2-ar-dark.png` (My Location in its honest no-fix state —
the tile preview renders only with a real fix, which web cannot
provide), `settings-v2-ar-dark.png`, `settings-v2-en-light.png`,
`alerts-v2-en-light.png`, `detect-v2-ar-dark.png`.
Physical-device screenshots: **none exist** — device verification
(TalkBack order, real GPS fix + tile load, small screens, keyboard)
remains a team task; see DEVICE-VERIFICATION-CHECKLIST.md.

## Tests & gates (final tree, HEAD `dedbf7c` + this doc)
- Jest: **26 suites / 379 tests, all passing** (348 redesign
  baseline retained; +10 copy, +21 GPS pure-module tests, PWA
  classifier separate: 18/18 via `npm run test:pwa`).
- `tsc --noEmit` clean; `expo lint` 0 problems.
- Android export OK; embedded models byte-identical
  (yolo11n `19bfdc3c…`, ppocr_det `04e8e0b6…`, ppocr_arabic_rec
  `1fc31af5…`); release-notes entry added.
- Test-change disclosure (copy fixes, not weakening — behavioral
  assertions untouched, counts unchanged): two expectations that
  asserted the *old banned dialect copy verbatim* were updated to
  the new strings (`speechService.test.ts` nothing-to-repeat text;
  `places.test.ts` not-found fragment), and the Home smoke case now
  expects `familySafety` instead of the two section titles the
  mandated Home composition removed.

## Publish status
**BLOCKED on auth in the coordinator environment**: `EXPO_TOKEN` is
absent from this shell and `eas whoami` reports "Not logged in"
(no stored session). Nothing was published by this pass. The exact
proven recipe is scripted at
`~/workspace/.scratch-basera/publish-v4.sh` (fresh android export →
up to 14 alternating-route `eas update --skip-bundler` attempts →
update list) — run it with `EXPO_TOKEN` set; the `dist/` in the repo
is already the verified export of the final HEAD.
