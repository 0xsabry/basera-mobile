# BASERA Guardian PWA

The guardian client for BASERA V1.1: a responsive, installable **PWA**
(not a plain page). Guardians sign in with their own Supabase account,
redeem a pairing code (which creates a *pending* request — the BASERA
user must still approve it in the app), and then see the last known
location + 24-hour history of the people who approved them, on an
OpenStreetMap/Leaflet map. All access is enforced by Supabase RLS;
this client can never read the location of anyone without an `active`
guardian link.

## Files
- `index.html` / `app.js` — UI + logic (AR default, EN toggle, RTL/LTR).
- `config.js` — **the only file you edit to deploy**: Supabase URL + anon
  key, optional Firebase web config + VAPID public key.
- `manifest.webmanifest`, `icons/` — installability.
- `service-worker.js` — app-shell cache (data is never cached).
- `firebase-messaging-sw.js` — FCM **Web Push** background handler.
  Inert until Firebase is configured in `config.js`.

## Notifications (FCM Web Push — owner correction)
Guardian browser notifications use **Firebase Cloud Messaging Web Push**
directly, NOT Expo Push (Expo Push cannot reach ordinary browsers).
Android-app notifications are a separate endpoint kind
(`push_endpoints.platform`: `web-fcm` here, `android-expo` in the app).
The FCM *server* credential lives only in the `notify-guardian` Edge
Function secrets — nothing secret ships in this PWA. Without Firebase
config, the PWA works completely except push (it says so in the UI).

## Deploy (any static HTTPS host)
1. Fill `config.js` (see `docs/GUARDIAN_SETUP.md`).
2. Serve this folder over **HTTPS** (service workers + Web Push require
   it; `localhost` also works for development).
3. In Supabase Dashboard → Authentication → URL Configuration, add the
   PWA origin to the allowed redirect/site URLs.
4. Open the URL, sign up/in, and pair with a code from the BASERA app.

No build step, no bundler, no secrets in the repo.
