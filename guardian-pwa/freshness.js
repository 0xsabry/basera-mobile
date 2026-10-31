// BASERA Guardian PWA — pure freshness classification for a shared location.
// UMD: works as window.BASERA_FRESHNESS in the browser and as
// module.exports in Node (for guardian-pwa/test-freshness.js).
// Pure: no DOM, no Date.now() — the caller passes `now` explicitly.
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.BASERA_FRESHNESS = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var RECENT_MS = 2 * 60 * 1000; // <= 2 minutes: updated-recently
  var LAST_KNOWN_MS = 15 * 60 * 1000; // <= 15 minutes: last-known

  function toMs(value) {
    if (value == null) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value instanceof Date) {
      var t = value.getTime();
      return Number.isFinite(t) ? t : null;
    }
    var parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Age is measured from recorded_at (when the phone recorded the fix),
  // falling back to updated_at (when the server row was last written).
  function timestampOf(latest) {
    if (!latest) return null;
    var recorded = toMs(latest.recorded_at);
    if (recorded != null) return recorded;
    return toMs(latest.updated_at);
  }

  /**
   * classifyGuardianLocation({ now, latest, sharingEnabled, online })
   *   now:            ms epoch number | Date | ISO string (required for age)
   *   latest:         { recorded_at, updated_at } | null
   *                   (row is deleted when sharing is disabled/revoked)
   *   sharingEnabled: boolean | null (null = unknown -> age-based result)
   *   online:         boolean
   * Returns { state, ageMinutes|null }.
   * Priority: no-internet > sharing-paused > no-signal >
   *           updated-recently (<=2m) > last-known (<=15m) > stale.
   */
  function classifyGuardianLocation(input) {
    var args = input || {};
    var latest = args.latest != null ? args.latest : null;
    var ts = timestampOf(latest);
    var nowMs = toMs(args.now);
    var ageMinutes = null;
    if (ts != null && nowMs != null) {
      ageMinutes = Math.max(0, (nowMs - ts) / 60000);
    }

    if (!args.online) {
      return { state: "no-internet", ageMinutes: ageMinutes };
    }
    if (args.sharingEnabled === false) {
      return { state: "sharing-paused", ageMinutes: ageMinutes };
    }
    if (latest == null) {
      return { state: "no-signal", ageMinutes: null };
    }
    if (ageMinutes == null) {
      // Row exists but carries no parseable timestamp.
      return { state: "stale", ageMinutes: null };
    }
    var ageMs = ageMinutes * 60000;
    if (ageMs <= RECENT_MS) {
      return { state: "updated-recently", ageMinutes: ageMinutes };
    }
    if (ageMs <= LAST_KNOWN_MS) {
      return { state: "last-known", ageMinutes: ageMinutes };
    }
    return { state: "stale", ageMinutes: ageMinutes };
  }

  return { classifyGuardianLocation: classifyGuardianLocation };
});
