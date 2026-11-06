# BASERA Guardian — current setup and safe operations

Last reviewed: 2026-11-06

## Status

The owner's Supabase project already exists and is used by the BASERA mobile app. The deployed contract was documented from live verification on 2026-10-31 in docs/SUPABASE_INTEGRATION.md.

The Guardian PWA source is in guardian-pwa/. Do not assume it is publicly hosted merely because the source exists. The current recorded status does not establish a verified public hosting URL.

The deployed contract differs from the original local design. This is important:

- Invite acceptance creates an active paired link immediately.
- There is no owner-approval step.
- Consent is stored per link and starts disabled for both location and SOS.
- The deployed location table stores the latest fix only.
- The deployed backend has no camera hazard_events table or notify-guardian function.
- The deployed backend does not provide browser push registration/delivery.

## Before doing anything

Read these files first:

1. docs/SUPABASE_INTEGRATION.md
2. supabase/README.md
3. supabase/functions/README.md
4. guardian-pwa/README.md

## Archived instructions — DO NOT EXECUTE

Old steps in the original setup checklist described a different local design. They are retained as history only and must not be used to configure the deployed project.

Do NOT:
- run archived migrations 0001–0004;
- run archived notify-guardian or cleanup-locations functions;
- run supabase db push to apply the old design;
- create a second production Supabase project;
- add service-role credentials to the app or PWA;
- enable or claim a feature based only on an old checklist.

The baseline migration under supabase/migrations documents already-deployed state. It is not a production provisioning script and must never be replayed against production.

The telemetry proposal migration is separate from the Guardian baseline. Check docs/TELEMETRY.md and verify its current migration history before any CLI action. Do not re-run it or attempt a repair without explicit owner approval.

## Safe remaining deployment work

If the PWA is not already hosted:

1. Choose an HTTPS static host approved by the owner.
2. Deploy only the guardian-pwa folder.
3. Confirm the public URL with the owner.
4. Add that exact URL to Supabase Auth Site URL / Redirect URLs.
5. Test sign-in, invite acceptance, latest-location display, SOS visibility, consent-off denial, and unlink behaviour using dedicated test accounts.
6. Record the date, test account roles, exact project reference, observed result, and screenshots without exposing personal data.

Do not configure Firebase browser push as if it were already supported by the deployed backend. Browser push requires an intentionally designed and deployed server endpoint; the current Guardian contract does not include one.

## Auth email (SMTP) — required owner configuration

Observed live 2026-11-06: auth emails are sent through the default
Supabase provider (sender `noreply@mail.app.supabase.io` — read from
a real delivered email) and its sending quota is a trickle: signup
and password-recovery requests returned
`429 over_email_send_rate_limit` after a handful of test emails, and
again minutes after a single successful send. For real users this
means registration and recovery fail unpredictably. **Until the
steps below are done and re-tested, email delivery must be
described as unreliable.** Dashboard only; no code change; never
paste provider credentials anywhere except the dashboard fields.

### Step 1 — pick a provider and verify a sending domain

Any transactional provider works (e.g. Brevo, Resend, Amazon SES,
Postmark). Create the account, add a domain you control (for
example a subdomain such as `mail.auramarketing.me`), and publish
exactly the DNS records the provider generates for it —
typically:

- **SPF** — one TXT record on the sending domain, of the form
  `v=spf1 include:<provider-include> ~all` (provider supplies the
  include value; merge with any existing SPF, never two records).
- **DKIM** — the provider's TXT or CNAME record(s) carrying its
  public key (SES gives three CNAMEs; most others one TXT/CNAME).
- **DMARC** — TXT on `_dmarc.<domain>`, e.g.
  `v=DMARC1; p=none; rua=mailto:you@your-domain` (start with
  `p=none` for monitoring).
- Some providers also ask for a **return-path / bounce CNAME**.

Wait until the provider's dashboard shows the domain **Verified**
before continuing — Supabase will happily save SMTP settings that
then fail SPF/DKIM at the receiving side.

### Step 2 — enter the SMTP settings in Supabase

Dashboard → **Authentication → Emails → SMTP Settings** (older UI:
Authentication → Settings → SMTP): turn on **Enable Custom SMTP**
and fill, from the provider: Sender email (on the verified
domain), Sender name (e.g. `BASERA`), Host, Port (usually 587),
Username, Password. Save.

### Step 3 — raise the sending rate limit

Dashboard → **Authentication → Rate Limits**: raise
**"Rate limit for sending emails"** to a value your provider plan
allows (e.g. 100/hour to start). With the built-in provider this
limit is effectively capped by Supabase; with custom SMTP your
setting governs.

### Step 4 — URL configuration (where email links land)

The app currently requests **no custom redirect**, so confirmation
and recovery links land on the project's **Site URL** after
verification. Dashboard → **Authentication → URL Configuration**:

- **Site URL**: set it to a real page you control that tells the
  user "email confirmed — return to the BASERA app and sign in"
  (today there is no such page; the Supabase default is a dead
  end). Any static page on your domain is fine.
- **Redirect URLs** allow-list: keep the Site URL, add the Guardian
  PWA origin once it is hosted, and add `basera://auth/confirm` —
  reserved for the future in-app deep-link handler (the app does
  not process auth deep links yet; do not present the deep link as
  working until it does).

### Step 5 — templates (optional, recommended)

Dashboard → **Authentication → Emails → Templates**: review
*Confirm sign up* and *Reset password*. One template set serves
both app languages; keep the subject/body bilingual (Arabic line
first, then English) rather than choosing one language.

### Step 6 — prove it (required before claiming it works)

1. Sign up a brand-new test address on a real mailbox you read.
   The confirmation email must arrive **from your domain's
   sender** (not `noreply@mail.app.supabase.io`).
2. Click the link → it lands on your Site URL page → return to the
   app → sign-in succeeds.
3. Request a password reset → the recovery email arrives from the
   same sender.
4. Send several auth emails in a row — no
   `over_email_send_rate_limit`. Record the results in TESTING.md.

## Invitation hardening — IMPLEMENTED on this branch, deployment needs owner approval

Invite codes are bearer <redacted> whoever holds a code can accept it
(re-verified live 2026-11-06 with an unrelated test account). The
mitigations in place are per-link consent (starts off) and unlink.
The hardened replacement — codes bound to the intended recipient's
verified email, hash-only storage, atomic single-use claim — is
implemented and unit-tested on this branch (Deno 10/10); the full
production change package (exact change, preflight, deploy steps,
smoke, rollback) is in `docs/INVITE_HARDENING_DEPLOY.md`. Production
still runs the bearer-code functions until the owner authorizes
that package. The original design note follows.
Binding an invite to the intended recipient's email — the
accept-guardian-invite function rejecting acceptance when the
signed-in user's email differs from the invited email — requires
changing the deployed Edge Functions and the invite-creation
payload, so it is a production change: do not deploy it without the
owner's explicit approval, a documented payload change for both
clients (app + PWA), and a rollback note (redeploy the previous
function version).

## Owner approval gate

Any production change to schema, RLS, Edge Functions, Auth settings, production data, hosting, APKs, or OTA updates requires the owner's explicit approval for that operation. Documentation review alone does not authorize a deployment.