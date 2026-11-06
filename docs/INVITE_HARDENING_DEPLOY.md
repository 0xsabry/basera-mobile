# Guardian invite hardening — production change package (NOT APPLIED)

Status: **prepared on branch `fix/guardian-reliability`; nothing in
this package has been applied to production.** Deployment requires
the project owner's explicit authorization, per step, in order.

## The change

Replace the two deployed pairing Edge Functions with email-bound
versions and ensure the invite storage columns they need exist.

| Piece | File |
|---|---|
| Additive migration (idempotent) | `supabase/migrations/20261107000000_guardian_invites_hardening.sql` |
| create-guardian-invite (hardened) | `supabase/functions/create-guardian-invite/{core.ts,index.ts}` |
| accept-guardian-invite (hardened) | `supabase/functions/accept-guardian-invite/{core.ts,index.ts}` |
| Logic tests (Deno, in-memory store) | `supabase/tests/invites/core.deno.test.ts` — **10/10 pass** |
| App client support | already on this branch: the Family tab asks for the family member's email and sends `invited_email`; it claims "bound to this email" in the UI **only** when the function confirms `bound_to_email: true` |

## Reason

Live tests (2026-11-06, twice) confirmed the deployed invite code
is a bearer <redacted>: any authenticated account holding a fresh
code could pair. Consent defaults (both flags FALSE) limited the
impact, but pairing itself was unauthenticated as to *who* accepts.

## Security impact of the fix

- Invitations are bound to the intended recipient's email; the
  accepter's **verified** email must match (case-insensitive).
- Codes are stored only as SHA-256 hashes; 15-minute expiry;
  single-use via an atomic conditional claim
  (`UPDATE … WHERE used_at IS NULL`) — concurrent accepts cannot
  both succeed; an already-paired pair returns its existing link.
- Every accept failure returns the same public error
  (`invalid_or_expired_invite`) — no oracle about which check
  failed; the specific reason is logged server-side only.
- Create requires the recipient email, rejects self-invites, and is
  rate-limited per wearer (5/hour → `invite_rate_limited`).
- `private.guardian_invites` keeps RLS enabled with **no client
  policies** — reachable only by the service role in Edge
  Functions.

## Step 0 (do first): preserve the currently deployed sources

The deployed functions' source was never committed to this repo.
Before replacing them, download both functions' current code from
the Supabase dashboard (Edge Functions → function → source) and
commit it under `supabase/functions-legacy/` on this branch, so the
rollback below is a redeploy, not a reconstruction.

## Step 1: preflight (read-only)

Run in the dashboard SQL Editor and keep the output:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'private' and table_name = 'guardian_invites'
order by ordinal_position;
```

Any result (including "no rows") is acceptable: the migration
creates the table if absent and adds any missing columns without
touching existing ones. Note pre-existing unused codes will simply
stop working at cutover — they expire within 15 minutes anyway.

## Step 2: apply the migration

Dashboard SQL Editor (paste the migration file) **or**
`supabase db push` from a linked checkout. Verify afterwards: the
table exists with columns `wearer_user_id, invited_email,
code_hash, created_at, expires_at, used_at, used_by`, a unique
index on `code_hash`, RLS enabled, zero policies.

## Step 3: deploy the two functions

Dashboard (create/edit each function with the two files) or CLI:

```bash
supabase functions deploy create-guardian-invite
supabase functions deploy accept-guardian-invite
```

Keep JWT verification ON for both (as deployed today).

## Step 4: post-deploy smoke (test accounts only)

1. Wearer creates an invite addressed to the guardian's email →
   response includes `bound_to_email: true`.
2. Guardian accepts → `paired`; link appears on both sides with
   both consent flags FALSE.
3. Stranger (third account) tries a fresh code addressed to the
   guardian → `invalid_or_expired_invite`, **no link created**, and
   the code remains usable by the guardian afterwards.
4. Re-accepting the used code fails; a code older than 15 minutes
   fails.
5. Consent/location/SOS spot checks behave exactly as before (the
   link model is unchanged).

## Rollback

Redeploy the Step-0 preserved legacy function sources. The
migration is additive (new table/columns only) and needs no
rollback; the legacy functions ignore the added columns. Client
apps in the field are compatible with both generations: they send
`invited_email` (ignored by the legacy create) and only claim
binding when the response confirms it.
