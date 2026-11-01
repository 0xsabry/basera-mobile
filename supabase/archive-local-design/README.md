# Archived local design — NEVER APPLIED to the live project

Everything in this folder is the **pre-deployment local design** for
BASERA's Supabase backend: the schema, RLS policies, RPCs and Edge
Functions as originally designed in this repo *before* the owner created
and deployed his own Supabase project.

**Status: history only.**

- These files were **never applied** to the live project
  (`vbvvwyeccsegfwprwrga`). Do NOT apply them — not to production, and
  not as a "fix" for anything.
- They are **superseded** by the deployed contract in
  [`docs/SUPABASE_INTEGRATION.md`](../../docs/SUPABASE_INTEGRATION.md),
  which was verified behaviourally against the running project
  (live harness 22/22 on 2026-10-31).
- The current deployed state is documented by the baseline migration
  [`supabase/migrations/20261031000000_baseline_deployed_state.sql`](../migrations/20261031000000_baseline_deployed_state.sql).

## Contents

| Path | What it was |
| --- | --- |
| `migrations/0001_schema.sql` | Original schema design (incl. tables that do not exist live, e.g. `location_points`, `hazard_events`, `push_endpoints`) |
| `migrations/0002_rls_and_functions.sql` | Original RLS + pairing RPCs (`create_pairing_code` / `redeem_pairing_code` / `approve_link` / `revoke_link` / `set_sharing_enabled`) — the deployed project uses Edge Functions instead |
| `migrations/0003_comments_and_cron.sql` | Original comments/cron design |
| `migrations/0004_saved_places.sql` | Original saved-places design |
| `functions/cleanup-locations/` | Designed location-cleanup function — not part of the deployed contract |
| `functions/notify-guardian/` | Designed guardian-notification function — **does not exist** in the deployed project |

## Key differences from the deployed truth

- Pairing: 6-digit codes + RPCs + a wearer **approval step** here;
  dashed-hex codes (~15 min TTL, rate-limited creation) via the
  `create-guardian-invite` / `accept-guardian-invite` Edge Functions
  live, with **no approval step**.
- Consent: booleans on `profiles` here; **per-link** flags on
  `guardian_links` live (profiles has no consent columns).
- Locations: 24 h `location_points` history here; **latest-only**
  `guardian_locations` live, no history anywhere.
- Push: `push_endpoints` (`android-expo` / `web-fcm`) here;
  `user_push_tokens` with platform `'android'` (the old `android-expo`
  value is rejected by the live CHECK) live.

The static test `src/guardian/__tests__/rlsStatic.test.ts` still
references this archived design — it documents this folder only, not
the deployed project.
