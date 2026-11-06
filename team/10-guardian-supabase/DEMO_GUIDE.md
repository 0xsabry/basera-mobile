# 10 — Demo Guide: Guardian & Supabase

## Before the session (mandatory prep — do NOT improvise accounts live)

Registration and recovery are rate-limited on the default email sender
(429 `over_email_send_rate_limit` was observed after a few sends), so:

1. **Pre-create both accounts** (wearer + guardian) and confirm both
   emails the day before.
2. Pre-link them with an invite code, or be ready to create one live —
   code creation is also rate-limited per wearer (roughly one per hour
   observed); a fresh code created the night before will be expired
   (15 min), so plan to create it at the start of the demo block.
3. Charge both devices; sign in on both before the session.

## Live demo script (8 steps)

1. Wearer signs in on the phone — session persists across restart.
2. Wearer creates an invite code (note the expiry shown).
3. Guardian accepts the code in the Guardian web app → link appears,
   both consents OFF.
4. Guardian view: no location, no SOS history (consent gates working).
5. Wearer turns location sharing ON for this guardian.
6. Guardian view: latest location appears with its freshness state.
7. Wearer revokes (toggle off / remove guardian) → guardian view loses
   the location; the stored location was deleted, not hidden.
8. Wearer enables SOS sharing, presses SOS → the alert appears in the
   guardian's SOS list.

## Expected behavior

- Every step's result matches the consent flags exactly; nothing is
  visible with flags off.
- SOS appears as a stored alert in the web app. Do **not** claim a push
  notification was delivered — delivery is untested.

## Fallback

- If a live step fails (network, rate limit): switch to the honest
  sentence: the flows were verified end-to-end at API level on
  2026-11-06 (pairing, consent gating, revocation 0→1→0, stranger
  negatives) — documented in `docs/SUPABASE_INTEGRATION.md` — and walk
  the committee through those records instead of retrying blindly.
- Never create throwaway accounts in front of the committee to "fix" a
  failed demo.
