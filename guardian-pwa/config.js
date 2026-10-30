// BASERA Guardian PWA — deploy-time configuration.
// Fill in the values from YOUR Supabase + Firebase projects (see
// docs/GUARDIAN_SETUP.md). The Supabase ANON key and the Firebase WEB
// config are public client configuration by design. NEVER put the
// Supabase service-role key or an FCM server credential in this file.
(function (root) {
  root.BASERA_CONFIG = {
    supabaseUrl: "", // e.g. "https://abcdefgh.supabase.co"
    supabaseAnonKey: "", // Supabase project Settings -> API -> anon public
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
  };
})(typeof self !== "undefined" ? self : window);
