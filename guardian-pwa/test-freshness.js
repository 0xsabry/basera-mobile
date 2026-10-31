// BASERA Guardian PWA — tests for freshness.js (plain node + node:assert).
// Run: node guardian-pwa/test-freshness.js   (or: npm run test:pwa)
"use strict";

const assert = require("node:assert");
const { classifyGuardianLocation } = require("./freshness.js");

const NOW = Date.parse("2026-10-31T12:00:00.000Z");
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const MIN = 60 * 1000;

let passed = 0;
function check(name, actual, expectedState, expectedAge) {
  assert.strictEqual(actual.state, expectedState, `${name}: state`);
  if (expectedAge !== undefined) {
    if (expectedAge === null) {
      assert.strictEqual(actual.ageMinutes, null, `${name}: ageMinutes null`);
    } else {
      assert.ok(
        typeof actual.ageMinutes === "number" &&
          Math.abs(actual.ageMinutes - expectedAge) < 1e-9,
        `${name}: ageMinutes ${actual.ageMinutes} !== ${expectedAge}`,
      );
    }
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

// --- each of the 6 states -------------------------------------------------
check(
  "no-internet",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(1 * MIN), updated_at: iso(1 * MIN) },
    sharingEnabled: true,
    online: false,
  }),
  "no-internet",
);
check(
  "sharing-paused",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(1 * MIN), updated_at: iso(1 * MIN) },
    sharingEnabled: false,
    online: true,
  }),
  "sharing-paused",
);
check(
  "no-signal (no latest row)",
  classifyGuardianLocation({
    now: NOW,
    latest: null,
    sharingEnabled: true,
    online: true,
  }),
  "no-signal",
  null,
);
check(
  "updated-recently",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(1 * MIN), updated_at: iso(1 * MIN) },
    sharingEnabled: true,
    online: true,
  }),
  "updated-recently",
  1,
);
check(
  "last-known",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(10 * MIN), updated_at: iso(10 * MIN) },
    sharingEnabled: true,
    online: true,
  }),
  "last-known",
  10,
);
check(
  "stale",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(60 * MIN), updated_at: iso(60 * MIN) },
    sharingEnabled: true,
    online: true,
  }),
  "stale",
  60,
);

// --- boundaries at exactly 2 and 15 minutes -------------------------------
check(
  "boundary: exactly 2 min is updated-recently",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(2 * MIN), updated_at: iso(2 * MIN) },
    sharingEnabled: true,
    online: true,
  }),
  "updated-recently",
  2,
);
check(
  "boundary: 2 min + 1ms is last-known",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(2 * MIN + 1), updated_at: iso(2 * MIN + 1) },
    sharingEnabled: true,
    online: true,
  }),
  "last-known",
);
check(
  "boundary: exactly 15 min is last-known",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(15 * MIN), updated_at: iso(15 * MIN) },
    sharingEnabled: true,
    online: true,
  }),
  "last-known",
  15,
);
check(
  "boundary: 15 min + 1ms is stale",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(15 * MIN + 1), updated_at: iso(15 * MIN + 1) },
    sharingEnabled: true,
    online: true,
  }),
  "stale",
);

// --- recorded_at is preferred over updated_at -----------------------------
check(
  "recorded_at preferred (recent recorded, old updated)",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(1 * MIN), updated_at: iso(60 * MIN) },
    sharingEnabled: true,
    online: true,
  }),
  "updated-recently",
  1,
);
check(
  "recorded_at preferred (old recorded, recent updated)",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(60 * MIN), updated_at: iso(1 * MIN) },
    sharingEnabled: true,
    online: true,
  }),
  "stale",
  60,
);
check(
  "updated_at fallback when recorded_at missing",
  classifyGuardianLocation({
    now: NOW,
    latest: { updated_at: iso(5 * MIN) },
    sharingEnabled: true,
    online: true,
  }),
  "last-known",
  5,
);

// --- sharingEnabled null + row present -> age-based state ------------------
check(
  "sharingEnabled null falls through to age-based state",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(1 * MIN), updated_at: iso(1 * MIN) },
    sharingEnabled: null,
    online: true,
  }),
  "updated-recently",
  1,
);
check(
  "sharingEnabled null + no row is no-signal (not sharing-paused)",
  classifyGuardianLocation({
    now: NOW,
    latest: null,
    sharingEnabled: null,
    online: true,
  }),
  "no-signal",
  null,
);

// --- offline overrides everything -----------------------------------------
check(
  "offline overrides sharing-paused + stale row",
  classifyGuardianLocation({
    now: NOW,
    latest: { recorded_at: iso(120 * MIN), updated_at: iso(120 * MIN) },
    sharingEnabled: false,
    online: false,
  }),
  "no-internet",
);
check(
  "offline overrides no-signal",
  classifyGuardianLocation({
    now: NOW,
    latest: null,
    sharingEnabled: true,
    online: false,
  }),
  "no-internet",
  null,
);

// --- priority: sharing-paused beats no-signal ------------------------------
check(
  "sharing-paused beats no-signal",
  classifyGuardianLocation({
    now: NOW,
    latest: null,
    sharingEnabled: false,
    online: true,
  }),
  "sharing-paused",
  null,
);

console.log(`\n${passed} freshness tests passed.`);
