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
Supabase provider and its sending quota is small — signup and
password-recovery requests returned `429 over_email_send_rate_limit`
after only a handful of test emails. For real users this means
registration and recovery can fail at busy moments. Owner steps
(dashboard only, no code change, no secrets in the repo):

1. Pick an SMTP provider (any transactional mail service) and create
   a sender identity on a domain you control; complete the provider's
   SPF/DKIM (and DMARC) DNS verification for that domain.
2. Supabase Dashboard → Authentication → Settings → SMTP Settings:
   enable custom SMTP and enter host, port, username, password,
   sender address, and sender name from the provider.
3. Authentication → Rate Limits: raise the email-sending limit to
   match the provider's allowance.
4. Authentication → URL Configuration: confirm the Site URL and the
   redirect allow-list contain the exact destinations the app and
   the Guardian PWA use; test one confirmation and one recovery
   email end-to-end afterwards and record the result in TESTING.md.

## Invitation hardening — proposed (needs separate owner approval)

Invite codes are bearer <redacted> whoever holds a code can accept it
(re-verified live 2026-11-06 with an unrelated test account). The
mitigations in place are per-link consent (starts off) and unlink.
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