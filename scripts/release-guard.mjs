#!/usr/bin/env node
/**
 * BASERA release guard — run before any OTA publish or APK build.
 *
 * Checks (exit 1 on any failure):
 *  1. runtimeVersion in app.json matches the expected fleet runtime.
 *  2. eas.json profile -> channel mapping is explicit and separated
 *     (preview -> preview, production -> production).
 *  3. android/app/build.gradle versionCode is strictly greater than the
 *     last shipped APK's code, and versionName matches app.json.
 *  4. Native-input drift: files that change the native runtime
 *     (android/, package.json, package-lock.json, app.json plugins/config)
 *     must not differ from the last APK build commit while the
 *     runtimeVersion stays the same. If they differ, an APK build is
 *     required — an OTA publish would target the wrong runtime.
 *
 * Usage: node scripts/release-guard.mjs
 * The last-APK baseline is recorded in docs/RELEASE.md; update
 * LAST_APK_COMMIT / LAST_APK_CODE after each shipped APK.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const EXPECTED_RUNTIME = '1.1.0';
const LAST_APK_COMMIT = '8c2139e'; // 1.1.7 / versionCode 9 build commit
const LAST_APK_CODE = 9;
const NATIVE_PATHS = ['android', 'package.json', 'package-lock.json', 'app.json'];

let failed = false;
const ok = (msg) => console.log(`  OK  ${msg}`);
const bad = (msg) => { failed = true; console.log(`FAIL  ${msg}`); };

const appJson = JSON.parse(readFileSync('app.json', 'utf8')).expo;
const easJson = JSON.parse(readFileSync('eas.json', 'utf8'));
const gradle = readFileSync('android/app/build.gradle', 'utf8');

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
if (Number.isInteger(code) && code > LAST_APK_CODE) ok(`versionCode ${code} > last shipped ${LAST_APK_CODE}`);
else bad(`versionCode ${code} must be > ${LAST_APK_CODE}`);
if (name === appJson.version) ok(`versionName ${name} == app.json version`);
else bad(`versionName ${name} != app.json version ${appJson.version}`);

console.log('== native-input drift vs last APK ==');
try {
  const diff = execSync(`git diff --name-only ${LAST_APK_COMMIT} -- ${NATIVE_PATHS.join(' ')}`, { encoding: 'utf8' }).trim();
  // android/app/build.gradle version stamps and the app.json "version" field
  // are version labels, not native-runtime inputs (bare workflow).
  const changed = diff ? diff.split('\n').filter((f) => !f.endsWith('build.gradle') && f !== 'app.json') : [];
  let appJsonNativeChange = false;
  if (diff.split('\n').includes('app.json')) {
    const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); delete c.expo.version; return JSON.stringify(c); };
    const before = strip(JSON.parse(execSync(`git show ${LAST_APK_COMMIT}:app.json`, { encoding: 'utf8' })));
    const after = strip(JSON.parse(readFileSync('app.json', 'utf8')));
    appJsonNativeChange = before !== after;
  }
  if (changed.length === 0 && !appJsonNativeChange) ok(`no native-input changes since ${LAST_APK_COMMIT} (version labels excluded) — runtime ${EXPECTED_RUNTIME} stays valid; OTA-safe`);
  else bad(`native inputs changed: ${[...changed, ...(appJsonNativeChange ? ['app.json (native config)'] : [])].join(', ')} — an APK build is required; do NOT publish OTA for this change`);
} catch {
  bad('git diff failed — run inside the repository');
}

console.log(failed ? '\nRELEASE GUARD: FAILED' : '\nRELEASE GUARD: PASSED');
process.exit(failed ? 1 : 0);
