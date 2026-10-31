# BASERA Copy Guide

The single source of truth for BASERA's UI wording. All strings live in
`src/i18n/strings.ts` (`en` + `ar`, key parity enforced) and are guarded by
`src/i18n/__tests__/copy.test.ts`. If you change copy, keep the tests green.

## Principles

- **Arabic-first, professional Modern Standard Arabic (MSA).** No Egyptian
  dialect in UI text. Banned: «لسه، عايز/عايزة، دوس، كده، عشان، أوي، يلا»,
  the standalone negation «مش», dialect verb prefixes (بيـ present, هـ future),
  and «دلوقتي» (use «حاليًا» / «الآن»). Spoken phrases may be warm, but stay
  short MSA.
- **English is equally concise.** No wordy paraphrase of the Arabic and no
  stiff literal translation in either direction — write each language
  natively.
- **Button labels: 1–3 words** (test budget: AR ≤ 28 chars, EN ≤ 32 chars).
  Section titles are short noun phrases. Descriptions are one short sentence,
  only where they help.
- **Errors state the problem + the next action** ("Location permission is
  off. Allow it in phone settings, then turn sharing on again.").
- **Success states what actually happened** ("SOS recorded.", "Places
  synced"), never vague praise.
- **No promotional exaggeration.** No slogans about "seeing the world"; the
  tagline is a plain description of the product.
- **Truthfulness is not optional.** Never word phone-camera analysis as
  glasses detection. Never claim a feature is absent when it exists. Keep
  every honesty caveat — service not configured, SOS delivery not guaranteed,
  hazard checks are scan-based (not continuous), model blind spots — just
  keep it short.
- **Long explanations: at most two short sentences** (test budget: AR ≤ 220
  chars, EN ≤ 260 chars), keeping every material fact: consent, approval,
  deletion, and retention.

## Terminology

One concept, one term — everywhere, in labels, body text, and speech.

| Concept | Arabic | English |
| --- | --- | --- |
| Detect (action) | وصف المشهد | Describe surroundings |
| Detection (noun) | وصف المحيط | Surroundings description |
| Read text | قراءة النص | Read text |
| Saved places | أماكني المحفوظة | Saved places |
| Guardian | الوصي (pl. الأوصياء) | Guardian |
| Location sharing | مشاركة الموقع | Location sharing |
| Safety alert | تنبيه سلامة / تنبيهات السلامة | Safety alert(s) |
| Danger alert | تنبيه خطر | Hazard warning |
| SOS | استغاثة | SOS |
| Glasses | النظارة | (Smart) glasses |
| Family | العائلة | Family |
| Ready state | جاهز | Ready |
| Phone location | موقع الهاتف | Phone location |
| Background tracking | التتبع في الخلفية | Background tracking |

Notes:

- "Alert" splits by context on purpose: scan findings are **تنبيه خطر**
  (hazard), the alerts screen and its entries are **تنبيهات السلامة**
  (safety). Do not mix the two within one context.
- Location freshness in the My Location card is qualitative — no exact
  minute counts: `< 60s` → `fixAgeNow`, `< 120s` → `fixAgeOneMinute`, older →
  `fixAgeFewMinutes`. Exact timestamps belong to `lastUpdateLabel`. If an
  exact relative age is ever needed elsewhere: EN composes
  `` `${n} ${minutesAgoSuffix}` `` ("5 min ago"); AR composes
  `` `قبل ${n} ${minutesWord}` `` («قبل 5 دقائق»).
- Map attribution is identical in both languages:
  `© OpenStreetMap contributors`.

## Before / after — the most-changed strings

### Tagline
- Before: AR «عينك الذكية — شوف العالم من خلال الصوت» / EN "Your AI eyes — see the world through sound"
- After: AR «المساعدة الذكية» / EN "Smart assistance"
- Why: promotional exaggeration and dialect («شوف») removed.

### Home greeting
- Before: AR «تحب تعمل إيه؟» / EN "What would you like to do?"
- After: AR «ما الذي تحتاج إليه؟» / EN "What do you need?"
- Why: dialect question replaced with a short, neutral MSA one.

### Glasses card
- Before: status AR «غير متصلة — الجهاز قيد التطوير» with a two-part body
  explaining the phone camera and future setup.
- After: status AR «النظارة غير متصلة» / EN "Glasses not connected"; body is
  one short sentence ("Your phone camera is the current input; the glasses
  will appear here when ready."). Development detail lives in the
  onboarding note, not on the home card.

### Guardian location note (truthfulness fix)
- Before: "…Background tracking is not in this version." / AR «…التتبع في
  الخلفية مش موجود في النسخة دي.»
- After: EN "This is your phone's location, not the glasses. Sharing runs
  while the app is open; background tracking is optional." / AR «هذا موقع
  هاتفك، وليس موقع النظارة. تعمل المشاركة أثناء فتح التطبيق، والتتبع في
  الخلفية اختياري.»
- Why: the old text was **false** — background tracking ships in this
  version (see the `bgTracking*` keys). The copy tests now scan both
  languages for that claim pattern so it cannot return.

### SOS explanation
- Before: two clauses of process narration in dialect Arabic.
- After: EN "SOS records an emergency event immediately and tries to notify
  your approved guardians. Delivery to their phones is not guaranteed." /
  AR «تسجّل الاستغاثة حدث طوارئ فورًا وتحاول إبلاغ الأوصياء المعتمدين
  لديك. وصول الإبلاغ إلى هواتفهم غير مضمون.»
- Why: same material facts (immediate recording, attempted notification,
  delivery not guaranteed) in two short sentences.

### Guardian sharing explanation
- Before: a long run-on paragraph (dialect Arabic, ~340 chars) covering
  recipients, foreground-only behaviour, and deletion.
- After: EN "When sharing is on, your phone location is sent only to
  guardians you approved — while the app is open, unless background tracking
  is on. Turning sharing off stops uploads and deletes your stored
  locations from the server."
- Why: consent (approved guardians only), scope (foreground, or background
  when enabled), and the deletion guarantee are all kept; everything else
  was cut.

### Ready state
- Before: AR «جاهز — اختار إجراء من تحت» / EN "Ready — pick an action below"
- After: AR «جاهز» / EN "Ready"
- Why: the instruction was redundant — the actions are directly below the
  status.
