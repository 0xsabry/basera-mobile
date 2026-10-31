// BASERA Guardian PWA — deploy-time configuration.
// Fill in the values from YOUR Supabase + Firebase projects (see
// docs/GUARDIAN_SETUP.md). The Supabase ANON key and the Firebase WEB
// config are public client configuration by design. NEVER put the
// Supabase service-role key or an FCM server credential in this file.
(function (root) {
  root.BASERA_CONFIG = {
    // Deployed BASERA project (owner-created). The publishable key is a
    // PUBLIC client key by design — RLS enforces all access. Never put a
    // secret/service-role key here.
    supabaseUrl: "https://vbvvwyeccsegfwprwrga.supabase.co",
    supabaseAnonKey: "sb_publishable_Jt84WL6Ra7Ww_XV34Bk8eA_NwDYSecI",
    // Firebase web app config (Project settings -> Your apps -> Web app).
    // Leave null to run the PWA fully WITHOUT push notifications.
    firebase: null,
    // firebase: {
    //   apiKey: "...",
    //   authDomain: "...firebaseapp.com",
    //   projectId: "...",
    //   messagingSenderId: "...",
    //   appId: "...",
    // },
    // Web Push certificate public key (Firebase -> Cloud Messaging ->
    // Web Push certificates). Public value; the private half stays server-side.
    vapidKey: "",
    // Map tile provider — configurable. The defaults use the public
    // OpenStreetMap tile service, which is best-effort with no SLA;
    // see the tile usage policy at
    // https://operations.osmfoundation.org/policies/tiles/ — for
    // heavier use, point these at your own tile host / provider.
    mapTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    mapAttribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    mapMaxZoom: 19,
  };
})(typeof self !== "undefined" ? self : window);
