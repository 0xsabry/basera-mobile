# Archived local design — DO NOT APPLY

These migrations (0001–0004), the functions in `../functions/`
(`notify-guardian`, `cleanup-locations`) and the SQL tests in
`../tests/` are the repo's ORIGINAL local design for the guardian
backend. The owner deployed his own Supabase project with a different
schema; these files were **never applied** to it and must not be
applied now — they are kept as history only.

The live contract (discovered and verified 2026-10-31) is documented
in `docs/SUPABASE_INTEGRATION.md`: tables `profiles`,
`guardian_links` (per-link consent), `guardian_locations`
(latest-only), `sos_alerts`, `user_push_tokens`, and the Edge
Functions `create-guardian-invite` / `accept-guardian-invite`.
