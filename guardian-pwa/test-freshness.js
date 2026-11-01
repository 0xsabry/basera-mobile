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

// ===========================================================================
// Realtime wiring (realtime.js) — DEPLOYED contract: one channel, a
// guardian_locations (*) binding and a sos_alerts (INSERT) binding per
// wearer, filtered on subject_user_id. Live delivery itself was
// verified against the real project (see docs/SUPABASE_INTEGRATION.md);
// these tests pin the client-side wiring with a fake supabase client.
// ===========================================================================
const { createGuardianRealtime } = require("./realtime.js");

let rtPassed = 0;
function rtCheck(name, cond) {
  assert.ok(cond, name);
  rtPassed += 1;
  console.log(`ok - ${name}`);
}

function fakeRtClient() {
  const channels = [];
  const removed = [];
  return {
    channels,
    removed,
    channel(name) {
      const ch = {
        name,
        bindings: [],
        on(event, filter, cb) {
          this.bindings.push({ event, filter, cb });
          return this;
        },
        subscribe() {
          return this;
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      removed.push(ch);
      return Promise.resolve("ok");
    },
  };
}

{
  const client = fakeRtClient();
  const locations = [];
  const sos = [];
  const rt = createGuardianRealtime({
    client,
    onLocation: (id, row, ev) => locations.push([id, row, ev]),
    onSos: (row) => sos.push(row),
  });
  rt.setWearers(["w1", "w2"]);
  rtCheck("one channel for all wearers", client.channels.length === 1);
  const ch = client.channels[0];
  rtCheck("two bindings per wearer (locations + sos)", ch.bindings.length === 4);
  rtCheck(
    "location binding filters subject_user_id",
    ch.bindings[0].filter.table === "guardian_locations" &&
      ch.bindings[0].filter.filter === "subject_user_id=eq.w1",
  );
  rtCheck(
    "sos binding is INSERT-only on sos_alerts",
    ch.bindings[1].filter.table === "sos_alerts" && ch.bindings[1].filter.event === "INSERT",
  );
  // Payloads route to the right callbacks.
  ch.bindings[0].cb({ eventType: "UPDATE", new: { latitude: 30, longitude: 31 } });
  rtCheck("location payload reaches onLocation", locations.length === 1 && locations[0][0] === "w1");
  ch.bindings[0].cb({ eventType: "DELETE", new: null });
  rtCheck("DELETE payload maps to null row", locations[1][1] === null);
  ch.bindings[1].cb({ eventType: "INSERT", new: { id: "s1", subject_user_id: "w1" } });
  rtCheck("sos payload reaches onSos", sos.length === 1 && sos[0].id === "s1");
  // Same set = no rebuild; new set = rebuild with teardown.
  rt.setWearers(["w2", "w1"]);
  rtCheck("same wearer set does not rebuild the channel", client.channels.length === 1);
  rt.setWearers(["w3"]);
  rtCheck("changed wearer set rebuilds", client.channels.length === 2 && client.removed.length === 1);
  rt.unsubscribe();
  rtCheck("unsubscribe removes the channel", client.removed.length === 2);
  rtCheck("wearerIds cleared after unsubscribe", rt.wearerIds().length === 0);
}

// ===========================================================================
// config.js carries the REAL deployed project (publishable key only).
// ===========================================================================
{
  const fs = require("node:fs");
  const vm = require("node:vm");
  const sandbox = { self: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "config.js"), "utf8"), sandbox);
  const cfg = sandbox.self.BASERA_CONFIG;
  rtCheck("config has the deployed project URL", cfg.supabaseUrl === "https://vbvvwyeccsegfwprwrga.supabase.co");
  rtCheck(
    "config key is a publishable (public) key, never a secret/service key",
    typeof cfg.supabasePublishableKey === "string" &&
      cfg.supabasePublishableKey.startsWith("sb_publishable_") &&
      !cfg.supabasePublishableKey.startsWith("sb_secret"),
  );
}

console.log(`\n${rtPassed} realtime/config tests passed.`);
