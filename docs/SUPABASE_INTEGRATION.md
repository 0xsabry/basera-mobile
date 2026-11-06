# BASERA × Supabase — Deployed Integration Contract

Status: **LIVE**. The owner created and deployed his own Supabase
project; the app (branch `v1.1`) and the Guardian PWA are wired to it.
This document records the contract **as discovered live** on
2026-10-31 — every claim below was verified first-hand against the
running project (authenticated PostgREST probes, Edge Function calls,
a Realtime subscription, and the RLS harness in
`scripts/live-rls-test.mjs`), not taken from the original design.

> The repo's local design under `supabase/` (migrations 0001–0004, the
> pairing RPCs, `notify-guardian`) is **superseded** wherever it
> conflicts with this document. Do NOT apply those migrations to the
> deployed project. See "Differences from the local design" below.

## Project

- URL: `https://vbvvwyeccsegfwprwrga.supabase.co`
- Client key: the **publishable** key (`sb_publishable_…`) — a public
  client key by design, shipped in `app.json` `extra` (overridable via
  `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`) and in
  `guardian-pwa/config.js`. No service-role/secret key exists in any
  client, and none may be added.
- Auth: email provider on, signup on, **email confirmation required**
  (`mailer_autoconfirm=false`). Signup therefore returns no session;
  the app shows a "check your email" state and does not pretend the
  user is signed in.
- The OpenAPI root (`/rest/v1/`) refuses non-secret keys
  (`401 Secret API key required`), so the schema below was discovered
  through authenticated row reads and PostgREST error messages
  (42703/23502/23514 name columns and constraints directly).

## Deployed schema (verified)

### `profiles`
`id` (uuid, = auth uid — an insert MUST include it; `{}` violates
RLS), `display_name`, `preferred_language` (default `'ar'`),
`created_at`, `updated_at`.

- **No signup trigger**: dashboard-created users had no profile row.
  Both clients idempotently ensure their own row after sign-in
  (insert-ignore on `id`; the app only fills `display_name` /
  `preferred_language` while they are empty — it never resets them).
- **There are NO consent columns on profiles** (the original brief
  assumed them; the deployed truth is per-link consent, below).
- Reads: own row always; a **linked guardian can read the wearer's
  profile**; an unlinked user cannot.

### `guardian_links` — pairing + PER-LINK consent
`id`, `subject_user_id` (the wearer), `guardian_user_id`,
**`location_sharing_enabled` (default false)**,
**`sos_sharing_enabled` (default false)**, `consent_version`
(`'1.0'`), `accepted_at`, `created_at`. **No status column.**

- Links are created only by `accept-guardian-invite` and are active
  immediately — **there is no pending/approval step** in the deployed
  model (the old local design had one; the UI no longer invents it).
- Consent is per (wearer, guardian) link and is **wearer-controlled**:
  updates by the subject affect the row; the same update by the
  guardian silently affects 0 rows (RLS). Turning a master toggle in
  the app fans out to all of the wearer's links.
- Codes are single-use. Re-accepting an already-used code — even by
  the same guardian for the already-paired pair — fails with
  `invalid_or_expired_invite` (re-verified live 2026-11-06; an earlier
  note here claimed accept returns the same `link_id` idempotently —
  that does not match the deployed behaviour). The existing link
  itself is unaffected and stays visible to both parties.
- **Either party can delete the link** (unlink), verified in both
  directions; deletion ends all link-scoped access immediately.

### `guardian_locations` — latest fix only
`subject_user_id` (PK), `latitude`, `longitude`, `accuracy_m`,
`recorded_at` (server-set at insert), `updated_at`. There is **no
history table** in the deployed project (the old design's
`location_points` does not exist).

- The wearer upserts with `onConflict: subject_user_id`. The wearer
  may write even with consent off; **reads by a guardian are gated by
  their link's `location_sharing_enabled`** — with the flag off the
  guardian's select returns `[]` even though the row exists. The
  wearer can delete their own row (the app does so when sharing is
  switched off, and the PWA never renders history).

### `sos_alerts`
`id`, `subject_user_id`, `latitude`, `longitude`, `accuracy_m`,
`status` (default `'active'`), `message`, `triggered_at`,
`resolved_at`.

- The wearer can insert even with SOS consent off at the table level;
  the **app only inserts when the wearer's aggregate SOS consent is
  on** — otherwise the SOS stays an honest local-only state.
- Guardian reads are gated by their link's `sos_sharing_enabled`.
- **Resolve is wearer-only**: the wearer can set
  `status='resolved'` + `resolved_at`; a guardian update affects 0
  rows even with consent on.
- **Clients cannot delete alerts** — there is no delete policy. The
  log is append-only; "delete my data" in the app says exactly this
  (alerts are retained server-side; removal needs an owner action).

### `user_push_tokens`
`id`, `user_id`, `expo_push_token` (NOT NULL), `platform` with a
CHECK constraint (**`'android'` verified**; values like
`'android-expo'` are rejected), `created_at`, `updated_at`.

- The app registers its Expo token here after sign-in (only when
  notification permission was already granted — registration never
  prompts), refreshes on token rotation, and deletes its rows on
  sign-out. **Registration only — delivery is untested and is not
  claimed anywhere.** There is no web/FCM endpoint table in the
  deployed project, so the PWA registers nothing server-side and says
  so (`webPushNotWired`).

## Edge Functions (verified payloads)

Both functions require the user's JWT (an apikey-only call is
rejected); clients call them via supabase-js `functions.invoke` with
an active session.

- `create-guardian-invite` (as the wearer, body `{}`) →
  `{ invite_code, expires_at }`. Code format: dashed hex, 8 groups of
  4 (e.g. `A5F2-99D2-…`). Expiry ≈ **15 minutes**.
  Creation is **rate-limited per wearer**: excess calls fail with
  `{"error":"invite_rate_limited"}` — the app surfaces this as its own
  honest state, and the harness retries with bounded backoff. The
  window is long: after this session's discovery + harness bursts,
  creates were still refused **48 minutes** after the last successful
  one and cleared by ~64 minutes after the burst began — consistent
  with a rolling ~1-hour quota (exact limit unknown). Bursts of test
  invites will stall — create sparingly.
- `accept-guardian-invite` (as the guardian, body `{ invite_code }`)
  → `{ link_id, status: "paired" }`.
  **Every failure returns the same code**:
  `{"error":"invalid_or_expired_invite"}` — wrong code, expired,
  already-used, and self-pairing are indistinguishable by design; the
  UI shows one combined "invalid or expired" message and never
  pretends to know which.

### Hardened replacement (branch-only, NOT deployed)

This branch carries an email-bound replacement for both functions
(`supabase/functions/{create,accept}-guardian-invite/`, additive
migration `20261107000000_guardian_invites_hardening.sql`, Deno
tests 10/10 in `supabase/tests/invites/`). Invites name the
recipient's email; acceptance requires the caller's VERIFIED email
to match; codes are stored as SHA-256 hashes and claimed
atomically (single-use under concurrency); all failures keep the
combined public error. Deployment is a separate owner-approved
package: `docs/INVITE_HARDENING_DEPLOY.md`. The app on this branch
already sends `invited_email` (the deployed create tolerates the
extra field — verified live 2026-11-06) and only claims binding
when the response confirms `bound_to_email: true`.
Consent revocation was re-verified end-to-end 2026-11-06 with the
correct `latitude`/`longitude` columns: guardian location rows
0 (off) → 1 (on) → 0 (after revoke); SOS rows 0 → ≥1 → 0.

### Bearer-code semantics (observed live — read this)
An invite code is a **bearer capability**: verified twice — the
unrelated third account ("stranger") accepted a real code and paired
successfully, including once **while a guardian link was already
active** (multiple links per wearer are allowed; each probe link was
removed immediately after). The deployed
mitigation is that **every new link starts with both consent flags
FALSE**, so a wrongly-paired account sees no location and no SOS
until the wearer explicitly enables consent for that link. Wearers
must treat codes like passwords during their 15-minute life.

## Realtime (verified live)
`guardian_locations` and `sos_alerts` stream over `postgres_changes`.
Verified 2026-10-31: a guardian subscribed with
`subject_user_id=eq.<wearer>` filters received the wearer's location
INSERT/UPDATE and SOS INSERT events within seconds. The PWA keeps one
channel per session with two bindings per linked wearer
(`guardian-pwa/realtime.js`), rebuilds it when the wearer set
changes, and unsubscribes on sign-out; the 30 s poll remains only as
a fallback. The app refreshes its family state on its own link
changes.

## Differences from the local design (old contract → deployed truth)

| Old (repo design) | Deployed (this integration) |
| --- | --- |
| Pairing RPCs `create_pairing_code` / `redeem_pairing_code` / `approve_link` / `revoke_link` / `set_sharing_enabled` | Edge Functions `create-guardian-invite` / `accept-guardian-invite`; consent + unlink are direct RLS-guarded table writes |
| Pending link + wearer **approval step** | No status column; accept activates immediately; approval UI removed |
| 6-digit codes | Dashed-hex codes, ~15 min TTL, rate-limited creation |
| Consent booleans on `profiles` | **Per-link** flags on `guardian_links`; profiles have no consent columns |
| `location_points` history (24 h) + `latest_locations` view | `guardian_locations` latest-only; no history anywhere |
| `guardian_locations.lat/lng/recorded_at`-style guesses | Actual columns: `latitude`, `longitude`, `accuracy_m`, `recorded_at`, `updated_at` |
| `hazard_events` table + `notify-guardian` push function | Neither exists. SOS = `sos_alerts` insert; camera hazards have no server table and are reported honestly as local-only |
| `push_endpoints` (web `'web-fcm'`, app `'android-expo'`) | `user_push_tokens` with `expo_push_token` and platform `'android'`/`'ios'`-style values |
| Guardian could ack/resolve hazards | SOS updates are wearer-only; nobody can delete alerts |
| "Supabase not configured" gating | Removed — real URL + publishable key are wired in app config and PWA `config.js` |

### Old-contract test changes (nothing weakened silently)
- `src/guardian/__tests__/supabaseGateway.test.ts` and
  `guardianService.test.ts`: rewritten against the deployed tables,
  payload and error code (`invalid_or_expired_invite` combined kind
  checked first in the classifier).
- `hazardService` tests: notifier now targets `sos_alerts`; camera
  hazards assert the honest `'unavailable'` result instead of a
  `hazard_events` insert; `notify-guardian` expectations removed.
- `locationSharing.test.ts` / `pendingDeletion.test.ts`:
  `LocationSharingService.start()` no longer writes consent (consent
  changes only via the explicit Family-screen toggles), expectations
  updated to match; the persisted deletion-obligation machine is
  unchanged in semantics (revoke + sharing-off + latest-row delete).
- `copy.test.ts`: `guardianApprove` / `guardianDeny` removed from the
  required label keys together with the approval UI they labelled.
- `rlsStatic.test.ts`: unchanged assertions — it now documents the
  archived local design only (see `supabase/migrations/README.md`).

## Live verification
`node scripts/live-rls-test.mjs` (credentials read from
`~/workspace/.scratch-basera/supabase-live/test-accounts.json`, never
committed) runs the full matrix: pre-pairing denials, invite create,
wrong-code + self-accept rejection, pairing with consent defaults,
location/SOS visibility gated by each flag separately, guardian
cannot change consent or resolve SOS, wearer resolve, Realtime
smoke, invite reuse rejection, consent-off access loss, latest-row
delete, push-token privacy, unlink from the guardian side.
**Final run 2026-10-31: 22/22 gated cases PASS** (plus the
bearer-code OBSERVED note above). Expired-invite rejection is marked
NOT TESTABLE in the harness (the function offers no expiry control
and all failures share one code).

## Remaining owner actions / known limits
- **Auth email sending hits the built-in provider rate limit
  (observed live 2026-11-06).** After a handful of confirmation /
  resend / recovery emails during end-to-end testing, `POST
  /auth/v1/signup` and `POST /auth/v1/recover` began returning
  `429 over_email_send_rate_limit` — i.e. new registrations that need
  a confirmation email are rejected while the quota is exhausted.
  This is the signature of the default Supabase email provider (no
  custom SMTP). **Owner action (dashboard, no code):** configure a
  custom SMTP provider under Authentication → Settings → SMTP
  Settings, raise Authentication → Rate Limits for email sending,
  and confirm the Site URL + redirect allow-list match the app's
  destinations. Until then, real email delivery is rate-limited and
  cannot be considered reliable.
  Delivery evidence (2026-11-06, later the same day): with the
  owner's Gmail reconnected, a fresh signup to an alias of the
  connected mailbox received its confirmation email within seconds —
  from the DEFAULT sender `noreply@mail.app.supabase.io` (direct
  evidence no custom SMTP is configured). Unverified sign-in is
  correctly refused (`400 email_not_confirmed`), so confirmations
  are enforced. But a password-recovery request minutes after that
  one successful email returned `429 over_email_send_rate_limit`
  again — the quota is effectively a trickle. The confirmation
  link's token is redaction-protected in the agent's mail view, so
  the link-follow and its redirect destination were not verified by
  the agent (the owner can click it in his own inbox).
- SOS alert rows can never be deleted by clients (append-only by
  design); purging test alerts needs a Dashboard/SQL action by the
  owner.
- Auth-account deletion has no client-callable path; the app's
  "delete my data" removes the user's own rows and signs out, and
  states that account removal requires an owner action.
- Push **delivery** (Expo → device, and any guardian web push) is
  untested; only token registration is implemented.
- Invite creation is rate-limited by the function; a wearer who
  creates many codes in a short window must wait (the app says so).
