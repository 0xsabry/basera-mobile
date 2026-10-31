# BASERA — Targeted Dependency Security Remediation (V1.1)

Date: 2026-10-31 · Branch: `v1.1` · Scope: build/test tooling dependencies only.
No runtime (app-bundle) dependency changed; `runtimeVersion` stays `1.1.0`;
no native files, versions, owner, project ID, or credentials were touched.

## Environment limitation (read first)

`npm audit` **cannot execute inside the agent sandbox**: the egress proxy
rejects the audit endpoint with `403 Forbidden – policy_denied`
(`POST https://registry.npmjs.org/-/npm/v1/security/audits/quick`, verified
repeatedly before and after the changes; the exact error body is kept in the
working records). All advisory data below therefore comes from the GitHub
Advisory API (authoritative GHSA records) + `npm view` registry metadata +
the owner's Windows `npm audit` findings that triggered this remediation.
**The owner should re-run `npm audit` on Windows after syncing this source**
to obtain npm's own before/after counts; the version evidence below is
complete enough to predict them (see “Expected audit effect”).

Baseline installed versions (from `npm ls … --all` + `package-lock.json`):
zod 3.25.76 (nested, @expo/cli) + 4.6.7 (root, dev), glob 13.0.6 (×12) +
10.5.0 (test-exclude), minimatch 10.2.6 / 9.0.9 / 3.1.5, deepmerge 4.3.1 (×2).

## Final table

| Advisory | Affected pkg/version | Vulnerable code path reachable? | Fix applied / reason none | Compatibility tests | Remaining accepted risk |
|---|---|---|---|---|---|
| GHSA-mrhx-c7xc-m3w5 (zod, vulnerable < 4.6.6, patched 4.6.6) | zod 3.25.76 (@expo/cli), zod 4.6.7 (root dev) | **No** — see §A | None needed: 4.6.7 ≥ 4.6.6 (already patched); v3 copy lacks the vulnerable `$ZodArray` code entirely and must not be forced to v4 (@expo/cli declares `zod: ^3.25.76` and uses the v3 API) | Full battery green (§E) | None for this advisory in this workflow |
| GHSA-3g3m-2fjr-6pw4 (glob, vulnerable ≥9.0.0 ≤14.0.1, patched 14.0.2) | glob 13.0.6 ×12 (@expo/*, expo-updates, jest), glob 10.5.0 (test-exclude) | Build-time only: patterns come from the project's own config/code over its own file tree; no attacker-controlled patterns or cwd in the export/build/test workflow | **Applied:** scoped per-parent `overrides` → glob **14.0.3** for all 12 instances of the 13.x line. **Not applied** to test-exclude's glob 10.5.0 (see §B) | Throwaway-tree proof + full battery: `npm ci`, `npm ls` 0 invalid, tsc, lint, jest 21/233, export + models hash-identical, `expo config` runtime 1.1.0, doctor unchanged | test-exclude's glob 10.5.0 remains (jest-coverage-only chain; npm refuses the override against the lockfile and its minimatch cannot move — §B) |
| GHSA-g3hv-75wg-m249 (minimatch, vulnerable < 11.0.1, patched 11.0.1) | minimatch 10.2.6 (fingerprint, typescript-estree, glob-13 chain, test-exclude), 9.0.9 (glob-10 chain), 3.1.5 (eslint chain) | Build/lint-time only: patterns are the project's own (config, lint rules, ignore files) | **Applied:** overrides → minimatch **11.0.3** for fingerprint, typescript-estree, test-exclude's direct use, and the whole glob-14 chain (glob 14 natively depends on minimatch ^11). **Pinned back to 9.0.9** under glob 10.5.0 (11 silently breaks its matching — §B). eslint's 3.1.5 **not** overridden (separate major line; eslint pins ^3 and there is no compatible 11-targeting release of its parents) | Same battery + targeted smokes: named-export calls as each parent makes them; glob-10 sync returns correct results only with 9.0.9 | minimatch 9.0.9 (glob-10's internal, coverage-only) and 3.1.5 (eslint lint tooling) remain in the advisory's numeric range; both process only the developer's own patterns |
| GHSA-gcqx-w48m-w2h4 (deepmerge, vulnerable 4.2.0–4.3.1, **no patched release**) | deepmerge 4.3.1 (@expo/config, jest-config) | **No untrusted input reaches it** — see §C | **None available:** registry `latest` = 4.3.1 = the installed, vulnerable version; GHSA lists first-patched = none. No fork/monkey-patch (per mission) | Full battery green | Accepted: prototype-poisoning merge exists in tooling that merges only the developer's own config objects; revisit if upstream ships a 4.3.2+ |

## §A — Zod analysis (no change made)

- The advisory (CVE-2023-54404) names the vulnerable code precisely:
  “the `handleArrayResult` parse logic in **`$ZodArray`**” — `$ZodArray` is
  Zod **v4-internal** code. The installed v3.25.76 tree was searched:
  no `$ZodArray`, no `handleArrayResult` — the vulnerable implementation
  does not exist in the v3 line. Upstream's only patched version is 4.6.6
  (v4 line); no v3 patch was issued.
- The root zod **4.6.7** (dev-only, via eslint-plugin-react-hooks /
  zod-validation-error) is **newer than the patched 4.6.6** — already fixed.
- @expo/cli 58.1.17 declares `zod: ^3.25.76` and its only zod consumers are
  `build/src/start/server/DevToolsPlugin.schema.js` and
  `createMCPDevToolsExtensionSchema.js`, using the classic v3 API
  (z.object ×8, z.string ×18, z.array ×4, z.enum, z.union…). These validate
  **local dev-tool plugin manifests during `expo start`** — not the
  export/OTA pipeline and not remote input. Forcing zod v4 into the CLI
  would violate its declared range and its v3-API call sites.
- The BASERA app code itself never imports zod (grep of `src/` = 0 hits).

**Verdict:** the npm-audit match on the v3 copy is a version-range artifact,
not an exploitable path in this project. No change; do not “fix” by forcing v4.

## §B — glob / minimatch: what was tried, what shipped, what remains

Every glob/minimatch instance was mapped from `package-lock.json`
(parent → declared range → installed): glob 13.0.6 under @expo/config,
@expo/config-plugins (×3), @expo/fingerprint, @expo/metro-config,
@expo/cli, @expo/prebuild-config's and @expo/inline-modules' config-plugins,
expo-updates, @jest/reporters, jest-config, jest-runtime (all `^13.x`);
glob 10.5.0 under test-exclude (`^10.4.1`); minimatch 10.2.6 under
fingerprint / typescript-estree / glob-13 / test-exclude (`^10.2.2`),
9.0.9 under glob-10 (`^9.0.4`), 3.1.5 under the eslint family (`^3.1.x`).

API surface the parents actually use (grepped from the installed builds):
glob — named `.glob()` (promise) and `.sync()`; minimatch — named exports
only (`minimatch`, `Minimatch`, `GLOBSTAR`, `escape`, `unescape`).
**Critical trap found by testing:** minimatch 11 removed the callable
default export, and **glob 10.5.0 + minimatch 11 silently returns empty
match results** (verified against a working baseline: same call returns
the file list with minimatch 9, `[]` with 11). A forced upgrade there
would have been worse than the advisory.

Experiments (all in a throwaway copy before touching the real tree):
1. Range-keyed overrides (`glob@^13…`) — partially applied, left
   `invalid` entries in `npm ls` (jest's `^13.0.6` specs missed). Rejected.
2. Global overrides — would have forced eslint's minimatch 3.x and
   test-exclude's glob/minimatch into breaking majors. Rejected.
3. **Per-parent scoped overrides (shipped)** — `npm ls` fully valid
   (0 invalid), every parent's exact call patterns smoke-tested,
   `expo config` resolves, full jest + export green in the throwaway
   before applying to the real tree.
4. test-exclude's glob 10.5.0 → 14: **refused by npm in every form tried**
   (name key and ancestry key): with the project lockfile present npm
   keeps the locked nested copy and reports the override `invalid`.
   Removing the lockfile to force it caused wider resolution drift —
   not acceptable. Its minimatch was therefore pinned to its working
   9.0.9 while test-exclude's *direct* minimatch use moved to 11.0.3.

Shipped `overrides` (package.json): @expo/config, @expo/config-plugins,
@expo/fingerprint, @expo/metro-config, @expo/cli, expo-updates,
@jest/reporters, jest-config, jest-runtime → `glob: 14.0.3`;
@expo/fingerprint, @typescript-eslint/typescript-estree → `minimatch: 11.0.3`;
test-exclude → `minimatch: 11.0.3` with nested `glob.minimatch: 9.0.9`.
Lockfile diff is contained to the glob/minimatch subtrees (glob, minimatch,
brace-expansion, balanced-match, lru-cache, path-scurry, minipass);
**zero version changes** in expo, expo-updates, react, react-native, or
any native/app dependency (verified programmatically against HEAD).

Exposure context (honest): the glob flaw (AbortSignal cancellation bypass
→ post-timeout traversal) and the minimatch flaw (globparts DoS) live in
build-time tooling that expands patterns from this repo's own config over
its own files on the developer's machine. There is no server, no remote
pattern input, and nothing of these packages ships in the app bundle
(they are dev/build dependencies; the OTA bundle content is unchanged —
export output and model hashes are identical to baseline).

## §C — deepmerge analysis (no fix exists; accepted risk)

- Registry truth: `npm view deepmerge` → versions end at **4.3.1**,
  `dist-tags.latest = 4.3.1`; GHSA-gcqx-w48m-w2h4 first-patched = **none**.
  The installed 4.3.1 is simultaneously the latest and the vulnerable one.
- Reachability: @expo/config (`build/Config.js:387,389`) merges the
  project's **own** app config with modifications produced by the
  project's **own** config plugins; jest-config merges Jest defaults with
  the project's own jest config. Every merged object originates from
  files/code in the developer's repo — no network, remote-config, or
  third-party object reaches `mergeObject` in the BASERA
  build/export/test workflow.
- No fork or monkey-patch was introduced (unreviewed merge semantics in
  the config path would be a bigger risk than the theoretical one).
  **Not claimed fixed.** Re-check when upstream publishes ≥ 4.3.2.

## §E — Verification battery (real tree, after the change)

Baseline doctor (pre-change): 3 checks failed — the known advisories
(non-CNG app-config sync note, RN Directory metadata, SDK version match:
slider 5.2.2 vs 5.2.1, RN 0.88.0 vs 0.88.1). Baseline jest: 21/233.

After applying the overrides:
1. `npm ci` ✅ (1178 packages, from the updated lock)
2. `npm ls zod deepmerge glob minimatch --all` ✅ **0 invalid** —
   glob 14.0.3 ×12 + 10.5.0 ×1; minimatch 11.0.3 ×13 + 9.0.9 ×1 + 3.1.5 ×5;
   zod 3.25.76 + 4.6.7 (unchanged); deepmerge 4.3.1 (unchanged, no fix exists)
3. `npm audit --omit=dev` ⚠️ **cannot run in this sandbox** (403
   policy_denied — §“Environment limitation”). Expected effect on a
   Windows run: the glob 13.x and minimatch 10.x/9.x findings in the
   @expo/jest chains clear; residual findings = glob 10.5.0 +
   minimatch 9.0.9 (test-exclude chain), minimatch 3.1.5 (eslint chain),
   deepmerge 4.3.1 (no patch), and the zod range-match on 3.25.76
   (not exploitable — §A), all documented above.
4. `npx tsc --noEmit` ✅ clean
5. `npm test -- --runInBand` ✅ **21 suites / 233 tests** (identical to baseline)
6. `npx expo export --platform android` ✅ — all 3 models in `dist` are
   SHA-256-identical to source (yolo11n `19bfdc3c…`, ppocr_det `04e8e0b6…`,
   ppocr_arabic_rec `1fc31af5…`); `expo config` resolves runtimeVersion `1.1.0`
7. `npx expo-doctor` — **3 checks failed, identical to baseline**
   (no new warnings; the same pre-existing advisories)
8. `npm run lint` ✅ exit 0

## OTA compatibility statement

The remediation changes **dev/build tooling only**. The exported JS bundle
and assets are byte-equivalent in structure to the pre-remediation export
(same models, same runtime), and `runtimeVersion` remains `1.1.0`. On the
evidence above, the remediated V1.1 source **still exports successfully and
remains compatible with the already-built Android runtime 1.1.0** — the
dependency report therefore raises no objection to the owner authorizing
the OTA publish from Windows. (This statement is about source/runtime
compatibility; on-device receipt of an update remains a device check.)

## Correction (2026-10-31, Windows audit reconciliation)
An earlier draft of this document said the vulnerable implementation was
absent from the installed zod 3.25.76 package. **That was wrong.** The
3.25.76 package ships both implementations: root export = v3
(`index.cjs` → `./v3/external.cjs`), plus the full v4 implementation under
the `zod/v4` subpath — including `$ZodArray.handleArrayResult` at
`v4/core/schemas.cjs:647`. Presence is confirmed; reachability is the
separate question, answered by the trace in the 2026-10-31 reconciliation
report: @expo/cli imports only `require("zod")` (root → v3) in two
dev-server schema files, no consumer of the nested copy loads `zod/v4`,
and neither zod nor deepmerge appears in the exported app bundle.
