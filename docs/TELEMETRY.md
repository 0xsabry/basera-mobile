# Installations & OTA Adoption Telemetry — design and rollout

Owner-facing system to answer two questions truthfully: how many real
installs run BASERA, and which devices actually APPLIED each OTA update
(downloaded is not applied).

## Feasibility verdict (checked 2026-11-01)

**Fully implementable as a JavaScript-only OTA update. No new APK, no
native change, no runtime/package/signer change.**

- Every dependency already ships inside APK 1.1.8: `expo-updates`
  (~58.0.19), `expo-secure-store`, `@react-native-async-storage`,
  `expo-constants`, and the app's own `readInstalledVersion`.
- The expo-updates JS surface was verified against the INSTALLED SDK
  type definitions (`Updates.updateId`, `Updates.isEmbeddedLaunch`,
  `Updates.channel`, `Updates.runtimeVersion`, check/fetch result
  unions) — the same discipline that fixed the 1.1.7 updater bug.
- **`expo-observe` is NOT in APK 1.1.8** (zero entries/references in the
  APK). Per the owner's rule it is not being added: a native library
  must not be introduced just for a metric. What Expo alone cannot
  provide anyway: a per-device adoption registry. EAS shows update
  groups and publish metadata, not which anonymous device applied
  which update — that is exactly what this telemetry adds.

## Architecture

```
App (JS, via OTA)
  src/telemetry/telemetry.ts   identity, queue, applied-detection,
                               verdict-aware flush + dead-letter store
  src/telemetry/index.ts       real wiring (SecureStore, fetch, facts)
  src/update/UpdateService.ts  optional telemetry sink at the
                               check/available/downloaded/failed seams
        │  HTTPS POST (publishable key + per-install secret header)
        ▼
Supabase Edge Function  telemetry-ingest  (thin hardened transport:
        │   streaming 64KB byte cap, batch>50 hard reject, fact
        │   validation; service role stays server-side)
        ▼
DB function  public.telemetry_ingest()  (the ONLY write path; ONE
        │   transaction: per-installation advisory lock, pin-or-verify
        │   secret, per-event classify new/duplicate/invalid,
        │   atomic hourly budget, heartbeat)
        ▼
Tables  app_installations / app_update_events  (RLS on, no client
        │                                       policies at all)
        ▼
basera_telemetry_private schema  dashboard logic (owner allowlist
                    enforced inside; never added to the Data API's
                    exposed schemas, so unreachable over REST)
public schema   three SECURITY INVOKER RPC wrappers — the entire
                read surface; they hold no privileges of their own
        ▼
Dashboard  telemetry-dashboard/index.html  (owner email/password
           login; the page alone grants nothing — RPCs refuse
           non-owners server-side)
```

### Verdicts and the client queue (v3)
Every processed batch returns per-event verdicts. The client removes
accepted + duplicate events, keeps `rate_limited` events queued for a
later flush, and moves any other rejected event (with its reason) to
a persisted local dead-letter store — kept on device for inspection,
never retried, never silently dropped. A failed REQUEST (oversized,
auth, server error, offline) returns no verdict and the client keeps
its entire queue.

### Identity & privacy (v5 — server-issued)
- The app ships NO CSPRNG: expo-crypto is absent from APK 1.1.8 (and
  from the dependency tree), no other random-values library is
  present, and no native dependency may be added for a metric.
  Math.random is never used for any telemetry identifier.
- Identity is therefore issued by the SERVER: on first contact the
  function calls `telemetry_bootstrap`, which mints the installation
  id and a 256-bit-equivalent secret from `gen_random_uuid()` (the
  server OS CSPRNG), returns the secret exactly once, and stores only
  its SHA-256 hash. The client persists id + secret in SecureStore
  (fallback AsyncStorage). Ingest REFUSES ids the server never issued
  (`unknown_installation`) — there is no self-registration.
- Event ids are also server-minted: bootstrap returns a pool of 100
  and every ingest verdict tops it up by 50. Events recorded before
  first contact queue WITHOUT ids and are assigned pooled ids —
  persisted before sending — at that first contact.
- Anonymous by design: no account/user link, no IMEI, no location, no
  contacts, no hardware IDs. Facts recorded: platform, OS version,
  app version + build, runtime, channel, running update id, and
  embedded-launch state as a TRI-STATE (a real boolean, or null =
  unknown — an absent fact is never coerced to false).
- Deduplication: installations by primary key; events by their
  unique server-issued event id (retries/replays are idempotent).

### Downloaded vs Applied
- `update_downloaded` fires when the bundle is staged.
- `update_applied` fires only at a LATER launch whose running update
  (`Updates.updateId` / `isEmbeddedLaunch`) matches the staged one —
  i.e. the device provably restarted onto the new bundle. A transition
  detected without our download path (native recovery / server
  rollback) is also recorded as applied for the update actually
  running, never for the staged one.
- Heartbeat: every flush carries the installation facts, so the same
  call registers the first launch and refreshes `last_seen_at` later.

### Offline, durability, and overflow (v5)
All queue mutations run through ONE serialized chain and are
persisted before the operation counts as done: `record()` resolves
only after its event is on disk; `flush()` first re-persists the
whole local state and refuses to send if storage fails; events are
removed only after a server verdict, and if the post-verdict persist
fails the in-memory state reverts so the events resend (the server
dedupes). Flush is attempted at launch and after each update event.

The 200-event queue NEVER drops a queued event. Overflow policy
(explicit and counted in persisted state, readable via diagnostics):
at capacity, incoming `update_check`/`update_available` are refused
(+counted); an incoming critical event (downloaded / applied /
failed) evicts the oldest queued `update_check` (else oldest
`update_available`, +counted); with nothing evictable it is refused
(+counted). The dead-letter store rotates at 100 with a persisted
drop counter — dead-lettered events were already definitively
refused by the server, so rotation loses local diagnostics only.

### Measurement trust limits (honest bounds)
- Counts are trustworthy for honest, unmodified clients.
- Installations are anonymous by design and bootstrap is
  unauthenticated (any genuine first launch must be able to obtain
  an identity), so a person running a modified/rooted build can mint
  extra fake installations (bounded by the 500/hour registration
  circuit breaker) or forge events for their OWN installation id
  (bound to their installation secret). The server bounds this with a
  request-size cap, batch cap, strict field validation and a
  per-installation hourly event budget, but the system does NOT claim
  to be tamper-proof against the owner of a modified device.
- Uninstall + reinstall creates a NEW installation (standard industry
  semantics): "installations" means reported active installs, not
  people. Adoption ratios between funnel stages (discovered →
  downloaded → applied) are the robust signal for update health.
- `last_seen_at` means "the app last contacted the telemetry
  endpoint", stamped server-side; client timestamps are sanity-checked
  and never used for ordering.

## Privileges this migration creates or changes (complete list)

New schema `basera_telemetry_private`: created; all privileges
revoked from PUBLIC/anon/authenticated; USAGE granted to
authenticated (needed so the INVOKER wrappers can resolve the private
functions — it does NOT expose the schema through the Data API,
whose exposed-schemas list is a separate platform setting that this
migration never touches).

| Object | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| tables app_installations / app_update_events / dashboard_owners | — | revoked (all) | revoked (all) | platform default (bypass) |
| public.telemetry_ingest (DEFINER) | revoked | revoked | revoked | **EXECUTE** |
| public.telemetry_bootstrap (DEFINER) | revoked | revoked | revoked | **EXECUTE** |
| basera_telemetry_private.is_dashboard_owner (DEFINER) | revoked | revoked | revoked | — |
| basera_telemetry_private.dashboard_* (DEFINER) | revoked | revoked | **EXECUTE** (owner gate inside) | — |
| public.dashboard_* wrappers (INVOKER) | revoked | revoked | **EXECUTE** | — |

RLS is enabled on the three tables with no client policies. Nothing
pre-existing in production is granted, revoked, altered, or dropped.

## Ingest endpoint protection (verify_jwt + abuse model)

- Deployed with `verify_jwt = true` (config.toml
  `[functions.telemetry-ingest]`, or the dashboard equivalent): the
  gateway rejects requests with no valid JWT before the code runs.
  The app sends the publishable key in the `apikey` header ONLY —
  the new Supabase keys are not JWTs and are never sent as Bearer
  tokens — with NO user session: telemetry must work logged-out, and
  a "valid request from APK 1.1.8" means exactly that shape plus the
  installation headers. verify_jwt is anti-noise only (the key is
  public by design).
- The real credential is the per-installation secret: 256-bit random,
  stored only as a SHA-256 hash, pinned on first use; a wrong secret
  is refused (403) and can neither read nor write anything.
- No-secret requests die at the header gate (401) before any database
  work. Oversized bodies die mid-stream at 64KB; batches over 50 die
  before the RPC; malformed envelopes fail inside the database
  function before any write.
- Fake-install floods: anonymous registration is unauthenticated by
  necessity (any real first launch must be able to register), so a
  global circuit breaker caps NEW installations at 500/hour
  (serialized in the database); existing installations are never
  affected. Per-installation event budget: 600/hour. Residual risk,
  stated plainly: a determined scripted attacker can still create up
  to the cap per hour; fake installs show up as dormant rows and do
  not distort per-update adoption ratios (they never hold real
  update ids through the full funnel). No personal data is stored
  that could be used to deanonymize anyone.

## Verification evidence (v4, local — nothing deployed)

The mandatory review battery ran against a real PostgreSQL 16 with
the migration applied verbatim (harness in `supabase/tests/telemetry/`,
with `auth.uid()` emulated exactly as Supabase implements it and the
platform roles anon/authenticated/service_role):

- **47/47 database checks**: everything from the v3 battery (clean
  apply; registration once; strict per-event rejections; duplicate
  resends store nothing; budget atomicity; **100 concurrent calls →
  1 installation, 100 events**; racing-secret registration → one
  pinned hash; funnel 3/2/1/1 = 33.3% **unchanged after duplicate
  resend**; `p_limit` floored) PLUS: public wrappers verified
  SECURITY INVOKER in `pg_proc` (prosecdef = false) with the private
  implementations + ingest as the only DEFINER functions; anon cannot
  execute the private functions at all; a non-owner calling a private
  function DIRECTLY is still refused by the owner gate; strict
  envelope — `p_events` null/object/51-entries returns an error and
  writes NOTHING (no registration, no heartbeat); a numeric
  `failure_reason` and a boolean `status` are rejected as
  `invalid_field_type` (never coerced), a non-object element as
  `invalid_event_shape`; the registration circuit breaker throttles
  the 501st new installation in an hour, writes no row, and leaves
  existing installations fully working.
- **11/11 Deno handler tests** (real Deno 2.5.4, the shipped
  `handleIngestRequest` with a fake RPC): a valid request with NO
  Supabase session succeeds (anon-key JWT only at the gateway); no
  secret → 401 before any RPC; wrong secret → 403 from the verdict;
  throttled → 429; JSON null/primitive/array roots → 400
  `invalid_body`; missing/non-array `events` → 400 `invalid_events`;
  51 events → 400 before the RPC; oversized stream → 413 before the
  RPC; `deno check` on the deployed wiring (index.ts + supabase-js
  types) passes.
- **46/46 client checks** (telemetry + update suites; full repo suite
  570/570): queue fully retained on request failure/offline; verdict
  accounting (accepted+duplicates removed, `rate_limited` kept
  queued, other rejections dead-lettered and persisted) — so a server
  rejection never deletes an event from the device silently.

Known limits of this evidence: the harness emulates Supabase's auth
surface on vanilla Postgres (the real project adds PostgREST + the
Deno runtime, whose deployed smoke test belongs to the execution
phase; a Supabase branch/test project is not available on the
current plan — branching needs Pro — so the local PostgreSQL 16
harness is the test environment, and production was inspected
read-only only); `v_recent` is bigint by declaration (code-verified —
exercising a >2^31 hourly event count is not practical); the
500-row `p_limit` ceiling and the 500/hour registration cap are
enforced in code and behavior-tested at their boundaries that
matter (floor/throttle), not load-tested beyond them; concurrency
semantics were proven, not throughput.

## Rollout (each step gated by the owner)

1. **Final approval** of the v3 SQL + function (the current review).
2. Apply the migration to project `vbvvwyeccsegfwprwrga` (additive
   only), then register the owner's confirmed Auth uid in
   `dashboard_owners` (one SQL line, in the migration header).
3. Deploy the `telemetry-ingest` Edge Function only (the two guardian
   functions stay untouched).
4. Host `telemetry-dashboard/index.html` on Cloudflare Pages (owner
   decision: the dashboard is NOT served from a Supabase Edge Function
   on the default domain). One-time setup needs the owner's Cloudflare
   login in the browser; the result is a stable `*.pages.dev` link.
   The page ships only the publishable key; every data read stays
   behind Supabase Auth + the owner-gated RPCs.
5. Acceptance test with ONE simulated + ONE real test installation.
6. Publish the client via the manual preview OTA workflow — a
   SEPARATE owner approval (acceptance gate as usual).
7. One-device test on the owner's phone, then verify the dashboard.

## Acceptance mapping

| Criterion | Proven by |
|---|---|
| First install recorded once | Jest: identity created once & reused; server PK + secret pinning |
| No duplicate per open | Same ID across launches; events unique by client_event_id |
| OTA arrival detected | update_check / update_available / update_downloaded events |
| Downloaded != Applied | Jest: applied fires only at the launch running the staged update, exactly once |
| Running version shown truthfully | Facts come from Updates.updateId / isEmbeddedLaunch + expo-application |
| Offline safety | Jest: queue persists through failed flushes, same event ids delivered later |
| Unauthorized access denied | RLS with no client policies; RPCs raise for non-owners (verified with anon + non-owner sessions in the live harness after deployment) |
