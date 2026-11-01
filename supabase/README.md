# Supabase in this repo — how it is managed

This folder manages BASERA's relationship with the owner's **existing**
Supabase project:

- Project ref: `vbvvwyeccsegfwprwrga`
- URL: `https://vbvvwyeccsegfwprwrga.supabase.co`
- Authoritative deployed contract: [`docs/SUPABASE_INTEGRATION.md`](../docs/SUPABASE_INTEGRATION.md)
  (verified behaviourally against the live project; harness
  `scripts/live-rls-test.mjs` passed 22/22 on 2026-10-31)

There is exactly **one** production project. This repo never creates
another one, and nothing here deploys to production automatically.

## Layout

| Path | Purpose |
| --- | --- |
| `config.toml` | Local-dev / CLI config only. Production settings live in the Dashboard and win on conflict. |
| `migrations/20261031000000_baseline_deployed_state.sql` | **Baseline** documenting the schema that is already live. Documentation, not a deploy script. |
| `migrations/` (future files) | The ONLY way schema changes are proposed: new timestamped migrations, reviewed before any deploy. |
| `functions/README.md` | The verified contract of the two deployed Edge Functions. Their source is not yet exported into this repo (pending owner export via access token / Dashboard). |
| `archive-local-design/` | The pre-deployment local design (migrations 0001–0004, `cleanup-locations`, `notify-guardian`). **Never applied** to the live project; kept for history only. |
| `tests/` | Legacy local-design test material. The live source of truth for RLS behaviour is `scripts/live-rls-test.mjs`. |

## Baseline policy (read before touching migrations)

1. The baseline migration represents state that **already exists** in
   production. **Never re-apply it to the live project.**
2. Before ANY CLI-driven change, reconcile the repo with the live
   project using `supabase db pull` and resolve drift in favour of the
   live project, updating docs if the contract has changed.
3. The baseline exists so local development and review have a faithful
   starting point — not as a provisioning script for production.

## How changes are made

- **Schema / RLS changes**: author a NEW migration file with a
  timestamped name (`YYYYMMDDHHMMSS_description.sql`) in
  `migrations/`. Never edit the baseline or any already-reviewed
  migration. Review the SQL — including RLS policies — before any
  deploy. Verify against the access matrix in
  `docs/SUPABASE_INTEGRATION.md` and re-run the live harness after an
  approved deploy.
- **Edge Function changes**: the deployed functions
  (`create-guardian-invite`, `accept-guardian-invite`) are managed in
  the Dashboard / via CLI by hand. Changes are written from the
  verified contract in `functions/README.md`, reviewed, and deployed
  **manually** — there is no automated function deployment.
- **No automatic production deployment on push.** Pushing to GitHub
  never changes the production database, its policies, or its
  functions. The GitHub integration is for code management and review
  only.
- **Secrets**: no service-role key, password, or access token is ever
  committed. Client apps use only the publishable key
  (`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  overrides; see `.env.example` for variable names).

## Release Gate

**Any** production change — schema, RLS policy, Edge Function, auth
setting, or data — requires the owner's **explicit approval** before it
is applied. No migration is executed against production, and no
function is deployed, without that approval. When in doubt, document
and ask; do not apply.

## UNVERIFIED details in the baseline

The contract doc does not establish the following; the baseline flags
each inline with `-- UNVERIFIED:` and they must be confirmed (e.g. via
`supabase db pull`) before being relied on:

- Whether `guardian_links.consent_version = '1.0'` is a column DEFAULT
  or always written by `accept-guardian-invite`.
- The full `user_push_tokens.platform` CHECK list: `'android'` is
  positively verified (and `'android-expo'` verified rejected);
  `'ios'` is inferred from the contract's design-difference notes.
- Exact numeric types of `latitude` / `longitude` / `accuracy_m`
  (baseline uses `double precision`).
- How `updated_at` columns are maintained (trigger vs client-written),
  and whether `guardian_locations.recorded_at` (verified server-set)
  is a DEFAULT or a trigger.
- Foreign keys to `auth.users` — none are asserted in the baseline.
- Whether per-pair accept idempotency is enforced by a UNIQUE
  constraint or by Edge Function logic (behaviour verified; mechanism
  not established).
- A dedicated profiles DELETE case was not separately harness-tested;
  the baseline's own-row delete policy reflects the documented
  "delete my data" flow.
- `guardian_links.accepted_at` nullability/default.
- Any uniqueness constraint on `user_push_tokens (user_id, expo_push_token)` — none asserted.
