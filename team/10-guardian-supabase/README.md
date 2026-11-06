# 10 — Guardian & Supabase

**Duration: 3 minutes**

## Scope

- Supabase as the backend: Auth (email/password with confirmation), a
  PostgreSQL database guarded by Row Level Security, and Edge Functions
  for pairing.
- The Guardian model: a wearer and their guardians, linked by a one-time
  invite code, with **per-link, per-feature consent** — location sharing
  and SOS sharing are separate flags, both OFF by default, controlled by
  the wearer.
- Location sharing: foreground/background collection on the wearer app,
  an offline queue, latest-only storage, and deletion on opt-out.
- SOS: a manual emergency alert stored in the backend and visible to
  consenting guardians in the Guardian web app (PWA).
- The Guardian PWA: what family members use — sign-in, wearer location
  with freshness states, SOS list.

## Production distinctions (never blur these)

- The **deployed** invite functions use bearer codes (whoever holds a
  valid code can accept it). An email-bound, hash-stored hardening exists
  in this repository as **candidate code** (functions + migration + tests)
  and is **not deployed**.
- Custom SMTP is **not** configured: auth email uses Supabase's default
  sender, and recovery hit `429 over_email_send_rate_limit`. Confirmation
  delivery and enforcement were verified live; the confirmation-link
  landing page test was not completed.
- Consent revocation was verified by live API tests (access closes when
  consent closes) — that is API-level verification, not a physical-device
  UI test.
- A stored SOS row does not prove a push notification was delivered; push
  delivery is untested, browser push is not established.

## Shared documentation

- [Defense pack — Guardian & Supabase](../../docs/DEFENSE_GUARDIAN_SUPABASE.md)
- [Supabase integration](../../docs/SUPABASE_INTEGRATION.md)
- [Guardian setup + SMTP runbook](../../docs/GUARDIAN_SETUP.md)
- [Invite hardening deploy package](../../docs/INVITE_HARDENING_DEPLOY.md)
- [Supabase folder README](../../supabase/README.md)

## Files in this folder

`SOURCE_MAP.md`, `CODE_WALKTHROUGH.md`, `PRESENTATION.md`, `DEMO_GUIDE.md`,
`EXPECTED_QUESTIONS.md`.
