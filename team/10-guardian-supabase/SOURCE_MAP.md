# 10 — Source Map: Guardian & Supabase

## Database (production, project ref in `docs/SUPABASE_INTEGRATION.md`)

| Table | Shape / rule |
|---|---|
| `profiles` | `id` = auth user id, `display_name`, `preferred_language` |
| `guardian_links` | wearer ↔ guardian pair; `location_sharing_enabled` and `sos_sharing_enabled` both default **false**; `consent_version`, `accepted_at` |
| `guardian_locations` | **latest only** — primary key is the wearer id; `latitude`, `longitude`, `accuracy_m`, `recorded_at`, `updated_at` |
| `sos_alerts` | append-only for clients (no client delete); wearer updates own rows (e.g., resolve) |
| `user_push_tokens` | Expo push token per user; `platform` CHECK = `android` |
| `private` schema | invite storage used by the pairing functions — live infrastructure, not exposed to clients |

Security posture: RLS on; the anonymous role has **zero** direct table
grants; access flows through policies + the pairing Edge Functions.

## Edge Functions

| Function | Deployed behavior | Repository state |
|---|---|---|
| `create-guardian-invite` | Creates a dashed-hex one-time code (~15 min expiry, single-use), rate-limited per wearer | Deployed source predates the repo; a hardened replacement is in `supabase/functions/create-guardian-invite/` (**candidate, not deployed**) |
| `accept-guardian-invite` | Redeems a code → creates the link; **all** failures return the same `invalid_or_expired_invite` | Hardened replacement in `supabase/functions/accept-guardian-invite/` (candidate) |
| `telemetry-ingest` | Anonymous update telemetry (section 03) | Source in repo, deployed 2026-11-01 |

Candidate hardening (commit `b1dfbb9`): requires `invited_email`, stores
only a SHA-256 hash of the code, requires the acceptor's **verified**
email to match, atomic single-use claim, migration
`supabase/migrations/20261107000000_guardian_invites_hardening.sql`
(additive, **not applied**). Deploy steps: `docs/INVITE_HARDENING_DEPLOY.md`.

## Mobile client

| Path | Key exports / role |
|---|---|
| `src/guardian/supabaseClient.ts` | The Supabase client (URL + publishable key from app config) |
| `src/guardian/supabaseGateway.ts` | The deployed-contract gateway: table shapes, `createInvite(client, invitedEmail)`, `parseInvitePayload()` (`invitedEmail`, `boundToEmail` — false against the deployed function), `classifyInviteErrorMessage()` |
| `src/guardian/GuardianService.ts` | `GuardianService`: `setSharingEnabled()` (fans consent out to all my links; off ⇒ delete latest location), `setSosSharingEnabled()`, `getConsent()` (aggregate over links), `setLinkConsent()`, `createPairingCode()`, typed `GuardianInviteError` kinds |
| `src/guardian/LocationSharingService.ts` | Foreground watch → upload latest; offline queue drain |
| `src/guardian/OfflineLocationQueue.ts` | FIFO queue for points collected offline |
| `src/guardian/PendingDeletion.ts` | Opt-out deletion: local off immediately, "confirmed" only after the server purge succeeds |
| `src/guardian/BackgroundLocationService.ts` + `backgroundTask.ts`/`backgroundTaskHandler.ts` | Opt-in background collection (separate consent + system permission) |
| `src/guardian/sharingState.ts` | The sharing state machine: off / foreground-only / background-active / permission-denied / gps-unavailable / offline-queueing / sync-pending |
| `src/guardian/PushTokenService.ts` | Registers the Expo push token into `user_push_tokens` (delivery itself untested) |
| `src/guardian/pairing.ts` | Invite-code helpers on the client |
| `src/app/(tabs)/family.tsx` | The wearer UI: status, toggles, per-guardian consent, pairing, privacy/deletion |
| `src/app/guardian-auth.tsx` | Sign-in/sign-up with specific messages (rate limit, email-not-confirmed mapped to dedicated strings) |

## Guardian PWA (`guardian-pwa/`)

| File | Role |
|---|---|
| `index.html`, `app.js` | Guardian web app: sign-in, wearers list, location view, SOS list |
| `config.js` | Public config (Supabase URL + publishable key, tile URL) |
| `freshness.js` | Shared freshness classifier (fresh/stale states) |
| `realtime.js` | Live updates wiring |
| `service-worker.js`, `manifest.webmanifest`, `icons/` | Installable PWA shell (icons still carry a pre-official mark) |
| `firebase-messaging-sw.js` | Web-push scaffold — delivery **not established** |
| `test-freshness.js` | PWA test battery (freshness + realtime/config) |

## Tests and live evidence

- Jest: `src/guardian/__tests__/` (service, gateway, location sharing,
  background, pairing, pending deletion, push token, RLS static contract).
- Deno: `supabase/tests/invites/core.deno.test.ts` — 10/10 for the
  candidate functions (binding, hash-only storage, single-winner race…).
- SQL: `supabase/tests/rls_tests.sql`.
- Live API verification (2026-11-06, production, test accounts): pairing,
  consent defaults, flag-gated visibility, revocation sequences
  (location 0→1→0, SOS 0→≥1→0), stranger-account negatives, tampered/used
  code rejection — see `docs/SUPABASE_INTEGRATION.md`.
