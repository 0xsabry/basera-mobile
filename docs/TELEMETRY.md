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
  its SHA-256 hash. The client persists id + secret as ONE value in
  SecureStore ONLY (never plain storage). Ingest REFUSES ids the
  server never issued (`unknown_installation`) — there is no
  self-registration.
- Event ids are also server-minted: bootstrap returns a pool of 100.
  After that, ids are granted ONLY against an explicit, sized client
  request (`pool_request`): the client asks only when its pool falls
  below 20, sized to refill to 100; the server clamps any grant to
  at most 100; the local pool is hard-capped at 150 with excess
  grants counted. A heartbeat that asks for nothing is granted
  nothing — repeated heartbeats cannot inflate the pool, and a
  consumed id never returns to the pool. Events recorded before
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

### Offline, durability, and overflow (v5 model, v6 storage)
All queue mutations run through ONE serialized chain and are
persisted before the operation counts as done: `record()` resolves
only after its event is on disk; `flush()` first re-persists the
whole local state and refuses to send if storage fails; events are
removed only after a server verdict, and if the post-verdict persist
fails the in-memory state reverts so the events resend (the server
dedupes). Flush is attempted at launch and after each update event.

**v6 storage hardening.** ALL mutable telemetry state — queue, event
id pool, lifecycle state, overflow counters, dead-letter — lives in
ONE Atomic State Envelope: a single key written with a single set()
per mutation. There is no multi-key pseudo-transaction left to tear:
a crash leaves the whole old envelope or the whole new one, so
consuming a pool id is durable in the same write as the event that
uses it (v5 persisted queue and pool separately and could resurrect
a consumed id after a restart). A corrupt envelope is quarantined
(raw bytes kept under a separate key) rather than trusted.
**Loading is fail-closed (v7):** a failed storage READ is never
mistaken for an empty envelope — while storage is unreadable, no
bootstrap, no ingest, and no writes happen at all, and `loaded` is
set only after a successful read + validation; if a corrupt
envelope cannot be quarantined, the client stays blocked instead of
starting fresh over the only copy. Recovery is automatic on the
next operation once storage answers again, with prior data intact.
**No legacy migration ships (v7):** the short-lived v5 multi-key
layout never reached a device — the last published OTA content
(commit `586f6cc`) and the 1.1.8 APK build commit (`f0a6f39`) both
predate the first telemetry commit (`e52583e`), and the shipped
1.1.8 bundle contains zero telemetry strings (grep-verified against
the APK file). Client storage therefore begins with this envelope.

The installation identity is the exception that proves the rule: id
+ secret together form ONE value stored in **SecureStore only** —
never in plain storage, not even as a fallback. If SecureStore is
unavailable, events keep queueing in the envelope but nothing is
sent and no bootstrap is requested (its result could not be stored);
sending resumes when SecureStore recovers. An issued identity whose
save fails is NOT adopted in memory; the next attempt re-reads local
storage first and only then asks the server again (the orphaned
server row stays dormant forever — it can never receive events).

The 200-event queue NEVER drops a queued event. Overflow policy
(explicit and counted in persisted state, readable via diagnostics):
at capacity, incoming `update_check`/`update_available` are refused
(+counted); an incoming critical event (downloaded / applied /
failed) evicts the oldest queued `update_check` (else oldest
`update_available`, +counted); with nothing evictable it is refused
(+counted). The dead-letter store rotates at 100 with a persisted
drop counter — dead-lettered events were already definitively
refused by the server, so rotation loses local diagnostics only.

### Configuration naming (v6)
The client key is a new-style Supabase **publishable** key, and the
configuration names now say so: env `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
app.json extra `supabasePublishableKey` (used by both the telemetry
resolver in `src/telemetry/config.ts` and the guardian resolver).
The legacy `..._ANON_KEY` / `supabaseAnonKey` names remain as
fallbacks during the rename so existing local envs keep working.
`expo config` evaluation (the object EAS embeds into APKs and Expo
serves in update manifests) was verified to carry the production URL
and the canonical publishable key, and the compiled bundle carries
the telemetry endpoint path; URL/key themselves are manifest data
resolved at runtime, exactly as the production guardian client
already relies on. The key value is never logged.

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

## Verification evidence (v7, closing round)

**Local:**
- PostgreSQL battery **55/55** on the final SQL, including the pool
  contract: a no-request heartbeat is granted 0 ids, a request for
  30 is granted exactly 30, a request for 5000 is clamped to 100.
- Deno **16/16** (+ `deno check` clean): sized pool requests pass
  through to the RPC; malformed ones (fractional, negative, string,
  >1000) are refused with `invalid_pool_request` before any RPC.
- Jest full repo **595/595** (`rlsStatic` still the only unrunnable
  suite, pre-existing): a 100-heartbeat run with 10 events grants
  ZERO verdict ids and ends at pool 90/100; a drained pool refills
  with exactly one sized request (85) back to 100; a rogue 200-id
  grant is capped at 150 with the excess counted; fail-closed load
  tests prove a storage read failure blocks bootstrap + ingest +
  writes and loses nothing on recovery, and a corrupt envelope
  whose quarantine write fails blocks everything with the original
  bytes untouched.
- The REAL `src/telemetry/index.ts` module is under test
  (indexWiring): the singleton's endpoint/key come from
  `resolveSupabaseConfig` via the canonical publishable names, and
  `facts()` returns `is_embedded_launch: null` when expo-updates is
  disabled/unreadable. A source guard asserts index.ts contains no
  legacy resolver strings and no `isEmbeddedLaunch: true` default.
  (Note: the v6 commit already contained this wiring — commit
  `4008081` lines 18/33/45; the closing round verified it in the
  committed blob and added the missing real-path test.)
- No-distribution proof for the removed legacy migration: git
  ancestry (`586f6cc`, `f0a6f39` both predate `e52583e`) + the
  shipped 1.1.8 bundle greps to zero telemetry strings while its
  fixed-updater markers are present.

**On the real Supabase smoke project** (`basera-telemetry-smoke`):
the v7 delta (drop 11-param ingest, create the 12-param sized-pool
version) and the updated function were deployed there and the pool
contract was exercised over HTTPS — see the closing report for the
transcript. Production was never opened.

## Verification evidence (v6, local — server unchanged since v5)

- **Client suite rewritten for the v6 storage model, all green**
  (telemetry + config suites; full repo 588/588, `rlsStatic` the
  only unrunnable suite, pre-existing and unrelated):
  - Event ids consumed from the pool are never reused across
    restarts (envelope persistence makes consumption durable in the
    same write as the event).
  - Crash points: enqueue write failure loses the event cleanly
    (restart sees the last whole envelope); pre-send persist failure
    blocks sending entirely; post-verdict persist failure resends
    the SAME ids after restart; a corrupt envelope is quarantined.
  - SecureStore outage: queueing continues, sending + bootstrap are
    fully disabled, recovery resumes delivery with nothing lost.
  - Identity: save failure → not adopted, retry re-reads storage
    first then re-issues; a pre-stored identity restores with zero
    bootstrap calls; the secret exists only inside the single
    SecureStore value, never in the envelope.
  - Tri-state: a null (unknown) embedded state crosses the wire as
    null and preserves a staged download, which a later knowable
    launch still reports as applied exactly once.
  - (The v6 build briefly carried a legacy-layout fold; v7 removed
    it after proving no v5 client was ever distributed — see the
    storage section.)
- **Configuration**: 4 resolver tests (canonical-first, legacy
  fallback, endpoint derivation); `expo config --type public --json`
  evaluation verified (booleans only, key never printed): production
  URL host present, canonical publishable key present, endpoint
  derivable. A production export's compiled bundle contains the
  telemetry endpoint path. Guardian PWA tests (13) pass with the
  renamed config property.
- The server side (SQL + Edge Function) is UNCHANGED in v6; the v5
  real-Supabase gateway evidence below stands as-is.

## Verification evidence (v5)

**On a REAL Supabase project** (throwaway `basera-telemetry-smoke`,
created only for this test — production was never opened; the
migration and function were deployed there and exercised over
HTTPS with curl):
- No key at all → the GATEWAY answers 401
  (`UNAUTHORIZED_NO_AUTH_HEADER`) before any function code.
- Publishable key in the `apikey` header ONLY (no Authorization
  header, no user session) + bootstrap → **200**, a server-issued
  installation id, 64-hex secret, and a 100-id pool — the
  session-less app request reaches the function with verify_jwt ON,
  proving the installation secret is the real credential.
- Ingest without secret headers → 401 (function); unissued id →
  403 `unknown_installation`; issued secret + one event → accepted;
  the same event replayed → duplicate; wrong secret → 403
  `secret_mismatch`; bootstrap carrying an `events` member → 400.
- This smoke test caught a REAL BUG the fake-RPC tests had missed:
  `mapIngestResult` dropped the verdict's `event_id_pool`, so the
  client's id pool could never replenish. Fixed, pinned by a Deno
  passthrough test, redeployed to the smoke project, and re-verified
  live (heartbeat and event verdicts now carry a fresh 50-id pool).

**Local** (real PostgreSQL 16 harness + Deno + jest):
- **53/53 database checks**, including: bootstrap issues independent
  id+secret pairs (also under 40 concurrent calls); the issued
  secret authenticates across the SQL/Node hash boundary; ingest
  refuses unissued ids and creates nothing; `is_embedded_launch`
  absent stays NULL through heartbeats until a real boolean arrives;
  100 concurrent ingests → exactly-once; funnel 3/2/1/1 = 33.3%
  unchanged after duplicate resend; circuit breaker throttles the
  501st bootstrap.
- **15/15 Deno handler tests** (+ `deno check` clean), including the
  bootstrap mode, tri-state fact validation, and the pool
  passthrough above.
- **54/54 client tests** (telemetry + update suites; full repo
  578/578): Math.random is never called (spy); identity issued once
  and reused; two installations independent; >200 events offline —
  200 queued, 10 refused + counted, zero queued events dropped;
  critical-event eviction counted; dead-letter rotation counted;
  record() resolves only after persistence; flush refuses to send
  when storage fails; a crash before the post-verdict persist
  resends the SAME event ids after restart; requests carry the
  publishable key as `apikey` with NO Authorization header.
- Not covered anywhere yet: the client running on a real Android
  device against any backend (needs the OTA phase), and dashboard
  RPCs exercised through PostgREST with real auth users on the
  smoke project (their SQL-level behavior is battery-proven; the
  hosted smoke verified the ingest path end-to-end).

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
