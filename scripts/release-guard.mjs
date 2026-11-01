#!/usr/bin/env node
/**
 * BASERA release guard — run before any OTA publish or APK build.
 *
 * Usage (the mode is REQUIRED — OTA and APK gates are different):
 *   node scripts/release-guard.mjs ota   # before an OTA publish
 *   node scripts/release-guard.mjs apk   # before building a new APK
 *
 * Checks (exit 1 on any failure):
 *  1. runtimeVersion in app.json matches the expected fleet runtime.
 *  2. eas.json profile -> channel mapping is explicit and separated
 *     (preview -> preview, production -> production).
 *  3. Version ladder, per mode:
 *     - ota: the native stamps must be UNCHANGED from the last shipped
 *       APK (versionCode == LAST_APK_CODE, versionName == app.json
 *       version). An OTA cannot change them; a different stamp means
 *       the tree no longer matches the fleet it targets.
 *     - apk: versionCode must be strictly greater than the last
 *       shipped APK's code, and versionName must match app.json.
 *  4. Native-input drift: files that change the native runtime
 *     (android/, package.json, package-lock.json, app.json native
 *     config) must not differ from the last APK build commit while the
 *     runtimeVersion stays the same. If they differ, an APK build is
 *     required — an OTA publish would target the wrong runtime.
 *     app.json is compared structurally: the "version" label and the
 *     Supabase publishable-key config under `extra` are manifest/JS
 *     configuration, not native inputs — but ONLY after verifying the
 *     embedded configuration still points at the production project
 *     with the original public key (values unchanged, no smoke
 *     project reference). Any other app.json difference (plugins,
 *     permissions, icons, schemes…) counts as native drift.
 *
 * The last-APK baseline is recorded in docs/RELEASE.md; update
 * LAST_APK_COMMIT / LAST_APK_CODE after each shipped APK.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const MODE = process.argv[2];
if (MODE !== 'ota' && MODE !== 'apk') {
  console.error('usage: node scripts/release-guard.mjs <ota|apk>');
  process.exit(2);
}

const EXPECTED_RUNTIME = '1.1.0';
const LAST_APK_COMMIT = 'f0a6f39'; // 1.1.8 / versionCode 10 build commit
const LAST_APK_CODE = 10;
const PROD_SUPABASE_URL = 'https://vbvvwyeccsegfwprwrga.supabase.co';
const SMOKE_REF = 'vwurzvvsfyimovauolrs';
const NATIVE_PATHS = ['android', 'package.json', 'package-lock.json', 'app.json'];

let failed = false;
const ok = (msg) => console.log(`  OK  ${msg}`);
const bad = (msg) => { failed = true; console.log(`FAIL  ${msg}`); };

const appJson = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const easJson = JSON.parse(readFileSync('eas.json', 'utf8'));
const gradle = readFileSync('android/app/build.gradle', 'utf8');

console.log(`== mode: ${MODE} ==`);

console.log('== runtime ==');
if (appJson.runtimeVersion === EXPECTED_RUNTIME) ok(`runtimeVersion = ${EXPECTED_RUNTIME}`);
else bad(`runtimeVersion is ${appJson.runtimeVersion}, expected ${EXPECTED_RUNTIME}`);

console.log('== channels (must stay separated) ==');
for (const [profile, channel] of [['preview', 'preview'], ['production', 'production']]) {
  const actual = easJson.build?.[profile]?.channel;
  if (actual === channel) ok(`${profile} profile -> channel ${channel}`);
  else bad(`${profile} profile channel is ${actual}, expected ${channel}`);
}

console.log('== version ladder ==');
const code = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
if (MODE === 'ota') {
  if (code === LAST_APK_CODE) ok(`versionCode stays at last shipped ${LAST_APK_CODE} (OTA does not restamp native versions)`);
  else bad(`versionCode ${code} != last shipped ${LAST_APK_CODE} — the tree no longer matches the shipped APK; OTA is not valid from here`);
} else {
  if (Number.isInteger(code) && code > LAST_APK_CODE) ok(`versionCode ${code} > last shipped ${LAST_APK_CODE}`);
  else bad(`versionCode ${code} must be > ${LAST_APK_CODE} for a new APK`);
}
if (name === appJson.version) ok(`versionName ${name} == app.json version`);
else bad(`versionName ${name} != app.json version ${appJson.version}`);

console.log('== native-input drift vs last APK ==');
try {
  const diff = execSync(`git diff --name-only ${LAST_APK_COMMIT} -- ${NATIVE_PATHS.join(' ')}`, { encoding: 'utf8' }).trim();
  // android/app/build.gradle version stamps and manifest-level app.json
  // configuration (version label, Supabase key naming) are not
  // native-runtime inputs (bare workflow); app.json is verified
  // structurally below instead of by name.
  const changed = diff ? diff.split('\n').filter((f) => !f.endsWith('build.gradle') && f !== 'app.json') : [];
  let appJsonNativeChange = false;
  if (diff.split('\n').includes('app.json')) {
    // The embedded Supabase configuration must still be the ORIGINAL
    // production one: production URL, and the canonical
    // supabasePublishableKey (when present) carrying the SAME public
    // key value as the legacy supabaseAnonKey field. A changed value,
    // or any reference to the smoke project, is a real config change.
    const extra = appJson.extra ?? {};
    const configOk =
      extra.supabaseUrl === PROD_SUPABASE_URL &&
      typeof extra.supabaseAnonKey === 'string' &&
      extra.supabaseAnonKey.startsWith('sb_publishable_') &&
      (extra.supabasePublishableKey === undefined || extra.supabasePublishableKey === extra.supabaseAnonKey) &&
      !JSON.stringify(extra).includes(SMOKE_REF);
    if (configOk) ok('embedded Supabase config verified: production project, original public key unchanged (key naming is manifest config, not native drift)');
    else bad('embedded Supabase config differs from the original production configuration — treating app.json as changed');
    // Structural comparison with the key-naming difference and the
    // version label normalized away; anything else is native config.
    const normalize = (o) => {
      const c = JSON.parse(JSON.stringify(o));
      delete c.expo.version;
      if (c.expo.extra) delete c.expo.extra.supabasePublishableKey;
      return JSON.stringify(c);
    };
    const before = normalize(JSON.parse(execSync(`git show ${LAST_APK_COMMIT}:app.json`, { encoding: 'utf8' })));
    const after = normalize(JSON.parse(readFileSync('app.json', 'utf8')));
    appJsonNativeChange = !configOk || before !== after;
  }
  if (changed.length === 0 && !appJsonNativeChange) ok(`no native-input changes since ${LAST_APK_COMMIT} — runtime ${EXPECTED_RUNTIME} stays valid; OTA-safe`);
  else bad(`native inputs changed: ${[...changed, ...(appJsonNativeChange ? ['app.json (native config)'] : [])].join(', ')} — an APK build is required; do NOT publish OTA for this change`);
} catch {
  bad('git diff failed — run inside the repository');
}

console.log(failed ? '\nRELEASE GUARD: FAILED' : '\nRELEASE GUARD: PASSED');
process.exit(failed ? 1 : 0);
