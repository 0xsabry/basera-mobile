# 10 — Expected Questions: Guardian & Supabase

**Q1. Why Supabase instead of Firebase or a custom server?**
PostgreSQL + Row Level Security lets us enforce authorization in the
database itself, and Edge Functions host the pairing logic server-side.
For a small team, managed Auth + Postgres + RLS is more auditable than
hand-rolled middleware.

**Q2. What stops a stranger from reading someone's location?**
RLS policies plus consent flags: a guardian's reads return rows only
while their link has the matching flag on. Verified live: an unrelated
third account read zero links, locations, and SOS rows, and revoking
consent closed access immediately (location rows 1→0, SOS rows ≥1→0).

**Q3. Is the invite code secure?**
The deployed code is a single-use, ~15-minute bearer code: whoever
holds it can accept — we state this plainly. The hardened replacement
(bound to the invitee's verified email, SHA-256 hash-only storage,
atomic single-use claim) is written and Deno-tested 10/10 in this repo
but is **not deployed**; deployment is a separate authorized step
(`docs/INVITE_HARDENING_DEPLOY.md`).

**Q4. Why do all invite failures return the same error?**
`invalid_or_expired_invite` for expired, used, tampered, and
not-yours codes alike — distinct reasons would let an attacker probe
which codes exist and why they failed. The specific reason is logged
server-side only.

**Q5. Where is consent stored and who controls it?**
On each `guardian_links` row: `location_sharing_enabled` and
`sos_sharing_enabled`, default false. Only the wearer writes them
(the service fans changes out from the wearer's session); a guardian's
attempt to PATCH consent silently no-ops — verified live.

**Q6. Latest-only location — why not a track history?**
Privacy and purpose: family follow-up needs "where is he now", not a
movement archive. One row per wearer, overwritten; turning sharing off
deletes it (with `PendingDeletion` confirming the server purge before
the UI may say "deleted").

**Q7. How does SOS work end to end?**
The wearer presses SOS → a row is inserted into `sos_alerts` (with the
current fix if available) → guardians whose link has
`sos_sharing_enabled` see it in the PWA. SOS rows are append-only for
clients. Push delivery is a separate, unproven step.

**Q8. What keys does the app ship, and is that safe?**
Only the publishable (anon) key — public by design. There is no
service-role key anywhere in the app or repo; privileged access exists
only inside Edge Functions' server environment. Anon has zero direct
table grants.

**Q9. What is the email problem you hit?**
No custom SMTP is configured, so Supabase's default sender + default
rate limits apply: signups/recovery hit `429
over_email_send_rate_limit` after a few messages. A confirmation email
was received and enforcement proven (`email_not_confirmed` blocks
sign-in), but production email needs the owner's SMTP + DNS setup —
runbook in `docs/GUARDIAN_SETUP.md`.

**Q10. How does background location sharing work?**
A separate opt-in (`BackgroundLocationService` + a TaskManager task):
its own switch, its own system permission, a persistent Android
notification, and uploads that respect the same consent flags. Off
deletes the stored location like foreground off.

**Q11. What does the Guardian PWA do, and how does it update?**
Family sign-in, wearer list, latest location with a freshness state
(same classifier as the app), SOS list; realtime wiring refreshes
views. It talks to the same Supabase project with the same publishable
key and RLS — no separate backend.

**Q12. What would you deploy next, in order?**
(1) The invite hardening (deploy package ready), (2) custom SMTP +
raised auth limits, (3) prove push delivery end to end, (4) guardian
flows on physical devices as a formal test pass. Each needs its own
explicit approval; none is hidden in another change.
