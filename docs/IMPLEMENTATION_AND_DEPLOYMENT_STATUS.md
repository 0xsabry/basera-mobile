# BASERA — Implementation and Deployment Status

The one document that separates four states people keep merging:
**in source code**, **tested**, **in production**, **verified on a
physical device**. Evidence dates are 2026-11-06 unless stated otherwise.
Branch/commit references are to `fix/guardian-reliability` (candidate)
and `v1.1` (canonical) as named per row.

| Feature / change | In source? | Tested? | In production? | Device-verified? | Limitations | Evidence |
|---|---|---|---|---|---|---|
| Guardian invite hardening (email-bound codes, SHA-256 storage, atomic single-use) | Yes — candidate branch | Deno 10/10 (binding, hash-only storage, race → one winner, uniform errors) | **No** — production still runs the bearer-code functions, which ignore `invited_email` | No | Deployment needs explicit owner approval + the Step-0 source download in the deploy package | Commit `b1dfbb9`; `docs/INVITE_HARDENING_DEPLOY.md` |
| Email confirmation (sign-up) | Yes (Supabase Auth defaults) | Delivery observed once in the owner's connected mailbox; confirmation enforcement proven (`email_not_confirmed` blocks sign-in) | Yes — default sender `noreply@mail.app.supabase.io`; **no custom SMTP** | Partial (mailbox-level, not an in-app device flow) | Confirmation-link landing/redirect test **not completed** (the link token is not readable outside the mailbox owner's browser session) | Live API checks 2026-11-06; `docs/GUARDIAN_SETUP.md` |
| Password recovery | Yes | Request reached the provider; delivery unreliable | Default sender only | No | Hit **429 `over_email_send_rate_limit`** after very few sends; needs owner-side SMTP provider + DNS + dashboard rate-limit changes | Live API checks 2026-11-06 |
| Location-sharing consent (per-link flags) | Yes | Live API: defaults off/off, flag-gated reads, guardian PATCH no-op, revocation location rows **0→1→0** | Yes | No (API-level only) | Device-UI flow not yet formally tested | Harnesses 2026-11-06; `docs/SUPABASE_INTEGRATION.md` |
| SOS workflow | Yes | Live API: visibility 0→≥1→0 across the SOS flag; append-only enforced | Yes (insert + read) | No | A stored SOS row does **not** prove push delivery; push delivery untested; browser push not established | Harnesses 2026-11-06 |
| Guardian PWA | Yes (`guardian-pwa/`) | PWA battery (freshness + realtime/config) passes | Code complete; **public hosting is an owner setup item** | No | Icons predate the official logo; web push scaffold only | `guardian-pwa/README.md` |
| Sharing error-handling improvements (specific network/session messages, GPS stop on failed enable, permission-denied surfacing) | Yes — branch | Jest (guardian + family paths), release-guard OTA PASS | **Published to preview OTA** 2026-11-06 as part of group `89ca0bf0…` (see below) | No | Owner's originally reported device error was never specified by screen/message; fixes target the diagnosed paths | Commit `6514222` |
| Voice-performance improvements (bounded 300 ms voice discovery, idle stop-skip, startup warm-ups, shared YOLO model) | Yes — branch | Jest incl. new `speechLatency.test.ts` (3 contracts) | **Published to preview OTA** 2026-11-06, group `89ca0bf0…` | **No** — improvement not yet confirmed on the vivo V27 | First-utterance behavior depends on device TTS enumeration speed | Commit `6514222` |
| Family screen fix (shorter copy, short status pills, SOS no-guardian explanation, feedback at top) | Yes — branch | Jest 671/671, tsc, lint, PWA, export; markers verified inside the served bundle | **Published to preview OTA** 2026-11-06, group `89ca0bf0-e6eb-45f1-93c9-253d658efdd7`, Android update `01a1b253…` | No — owner applies the update and re-checks | Expo-side update message still shows the workflow's static "Egyptian voice" text (cosmetic; in-app release note is correct) | Commit `aa1dcd2`; workflow run `01a1b249`; acceptance gate 32/32 hashes |
| Camera / model initialization (prewarm) | Yes — branch | Unit-level (warm-up speaks nothing; shared model promise) | Same OTA group `89ca0bf0…` | No timing measurement on device | Cold-start numbers on the target phone are unmeasured | Commits `6514222`, `aa1dcd2` |
| Android / Expo build status | 1.1.8 (code 10) is the shipped native build | File-verified (package + signer match all prior builds) | Preview channel serves OTA group `89ca0bf0…` on runtime 1.1.0; rollback target `057a8909…` | Install-over of 1.1.8 reported by owner; per-member receipt unprovable | Builds ≤ code 8 contain the broken OTA client and can never receive OTA; they need the 1.1.8 rescue APK | `docs/RELEASE.md` |
| Telemetry backend (anonymous update stats) | Yes | Local PG battery 55/55 + Deno 16/16 at design freeze; production synthetic smoke passed and was cleaned | **Yes** — migration applied + `telemetry-ingest` deployed 2026-11-01 (limited approval) | Smoke build passed on a spare phone (full plan) | Dashboard owner registration + hosting still pending owner decisions; migration-history row gap documented (bookkeeping only) | `docs/TELEMETRY.md` |
| Expired-invite acceptance (deployed functions) | n/a (behavior question) | **Pending** — a timed probe (create → wait past the 15-min TTL → accept) is running; earlier readings were inconclusive due to a clock-conversion error and the ~hourly create quota | — | — | Result will be recorded here and in `docs/SUPABASE_INTEGRATION.md` when the probe lands | Probe started 2026-11-06 evening |
| Smart glasses input | Placeholder type only | Unit test pins the NotAvailable behavior | No | No | Future hardware; no fake connection is presented anywhere | `src/input/SmartGlassesCameraSource.ts` |
| KemeTone Egyptian neural voice | **Not in this repo's app** (external prototype) | G2P 28/28 byte-identical + engine init 2,725 ms proven on a vivo V2231 (prototype app) | No | Audio generation **not** proven | Not integrated; would need a native module + new APK | Prototype workspace, separate from this repo |

## Reading this table

- "Published to preview OTA" means the Expo Updates **preview** channel
  serves the update and the acceptance gate (protocol request, manifest,
  32/32 asset hashes, content identity) passed. It does **not** mean any
  particular phone has applied it.
- "In production" for Supabase rows means the deployed project
  `vbvvwyeccsegfwprwrga` as verified by the live checks cited.
- Nothing in this table is a device claim unless the Device-verified
  column says so explicitly.
