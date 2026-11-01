# Edge Functions — deployed contract

The live Supabase project (`vbvvwyeccsegfwprwrga`) has **two** deployed
Edge Functions. They implement guardian pairing; everything else in the
guardian feature is direct RLS-guarded table access (see
`docs/SUPABASE_INTEGRATION.md` and the baseline migration in
`supabase/migrations/`).

> **Source of truth is the deployed project.** The functions' source
> code is **not yet exported into this repo** — exporting it is pending
> a Supabase access token / dashboard export by the owner. Nothing in
> this folder is function source; do not treat any local file as the
> deployed code, and do not write replacement source from this document
> and assume it matches production. This README records only the
> **behaviourally verified** contract (live harness, 2026-10-31).

## Common behaviour

- Both functions **require the caller's user JWT** — a call with only
  the apikey (publishable key) is rejected. Clients invoke them via
  supabase-js `functions.invoke` with an active session.
- Links created through pairing are active **immediately** — there is
  no pending/approval step in the deployed model.

## `create-guardian-invite`

Called **as the wearer**, body `{}`.

- Returns: `{ invite_code, expires_at }`.
- `invite_code` format: **dashed hex, 8 groups of 4** characters
  (e.g. `A5F2-99D2-…`).
- Expiry ≈ **15 minutes** from creation.
- **Rate-limited per wearer**: excess creations fail with
  `{"error":"invite_rate_limited"}`. Observed behaviour is consistent
  with a rolling **~1-hour** quota (creates were still refused 48
  minutes after a burst and cleared by ~64 minutes; the exact limit is
  unknown). Create invites sparingly; the app surfaces the rate-limit
  state honestly and retries with bounded backoff.

## `accept-guardian-invite`

Called **as the guardian**, body `{ invite_code }`.

- On success returns: `{ link_id, status: "paired" }`, and creates the
  `guardian_links` row.
- **Idempotent per pair**: re-accepting for an already-paired pair
  returns the same `link_id`.
- **Every failure returns the same error**:
  `{"error":"invalid_or_expired_invite"}` — wrong code, expired code,
  already-used code, and self-pairing are indistinguishable by design.
  The UI shows one combined "invalid or expired" message.

## Bearer-code caveat (verified live — read before changing anything)

An invite code is a **bearer capability**: anyone holding a valid code
can pair with the wearer. This was verified live — an unrelated third
account accepted a real code and paired successfully, including while
another guardian link was already active (multiple links per wearer
are allowed).

The deployed mitigation is that **every new link starts with both
consent flags FALSE** (`location_sharing_enabled = false`,
`sos_sharing_enabled = false` on `guardian_links`), so a wrongly-paired
account sees no location and no SOS until the wearer explicitly enables
consent for that link. Wearers must treat codes like passwords during
their 15-minute life.

## What is NOT deployed

- `notify-guardian` and `cleanup-locations` exist only in
  `supabase/archive-local-design/functions/` (the pre-deployment local
  design). They are **not** deployed; there is no `hazard_events`
  table and no push-sending function in the live project. Push is
  token-registration only (`user_push_tokens`); delivery is untested.
- There are no pairing RPCs in the deployed project; the old design's
  `create_pairing_code` / `redeem_pairing_code` / `approve_link` /
  `revoke_link` / `set_sharing_enabled` were never applied.
