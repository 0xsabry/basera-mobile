// BASERA Guardian PWA — Realtime wiring for live guardian updates.
// UMD: window.BASERA_REALTIME in the browser, module.exports in Node
// (guardian-pwa/test-freshness.js). The factory takes a supabase-js
// shaped client; all table/column names follow the DEPLOYED contract
// (docs/SUPABASE_INTEGRATION.md): guardian_locations +
// sos_alerts keyed by subject_user_id (the wearer).
//
// Live delivery was verified against the deployed project: a guardian
// subscribed to these tables receives the wearer's location upserts
// and SOS inserts within seconds. RLS still applies to Realtime — a
// guardian only receives rows for wearers whose link grants the
// matching consent (location_sharing_enabled / sos_sharing_enabled).
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.BASERA_REALTIME = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SUBJECT = "subject_user_id";

  /**
   * createGuardianRealtime({ client, onLocation, onSos })
   *   onLocation(wearerId, rowOrNull, eventType)
   *   onSos(alertRow)
   * Returns { setWearers(ids), unsubscribe(), wearerIds() }.
   * One channel carries a location binding (*) and an SOS binding
   * (INSERT) per wearer; setWearers rebuilds it when the set changes.
   */
  function createGuardianRealtime(deps) {
    var client = deps && deps.client;
    var onLocation = (deps && deps.onLocation) || function () {};
    var onSos = (deps && deps.onSos) || function () {};
    var channel = null;
    var currentIds = [];

    function sameSet(a, b) {
      if (a.length !== b.length) return false;
      var sortedA = a.slice().sort();
      var sortedB = b.slice().sort();
      return sortedA.every(function (v, i) {
        return v === sortedB[i];
      });
    }

    function teardown() {
      if (channel && client) {
        var ch = channel;
        channel = null;
        if (typeof client.removeChannel === "function") {
          Promise.resolve(client.removeChannel(ch)).catch(function () {});
        }
      }
    }

    function setWearers(ids) {
      var next = Array.isArray(ids) ? ids.filter(Boolean) : [];
      if (sameSet(next, currentIds) && channel) return;
      currentIds = next;
      teardown();
      if (!client || typeof client.channel !== "function" || next.length === 0) {
        return;
      }
      var ch = client.channel("basera-pwa-guardian");
      next.forEach(function (wearerId) {
        ch = ch.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "guardian_locations",
            filter: SUBJECT + "=eq." + wearerId,
          },
          function (payload) {
            if (!payload) return;
            if (payload.eventType === "DELETE" || !payload.new) {
              onLocation(wearerId, null, payload.eventType);
            } else {
              onLocation(wearerId, payload.new, payload.eventType);
            }
          },
        );
        ch = ch.on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "sos_alerts",
            filter: SUBJECT + "=eq." + wearerId,
          },
          function (payload) {
            if (payload && payload.new) onSos(payload.new);
          },
        );
      });
      channel = ch.subscribe();
    }

    return {
      setWearers: setWearers,
      unsubscribe: function () {
        currentIds = [];
        teardown();
      },
      wearerIds: function () {
        return currentIds.slice();
      },
    };
  }

  return { createGuardianRealtime: createGuardianRealtime };
});
