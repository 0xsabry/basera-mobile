/* BASERA Guardian PWA — Firebase Cloud Messaging service worker.
   Handles BACKGROUND Web Push messages. Loaded only when the owner has
   configured Firebase in config.js; without config it stays inert.
   The FCM server key never appears here — this file only displays
   notifications that the server (Edge Function) sent. */
/* global firebase */
importScripts("config.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

(function () {
  var cfg = (typeof self !== "undefined" && self.BASERA_CONFIG) || {};
  if (!cfg.firebase) return; // notifications not configured — inert by design
  firebase.initializeApp(cfg.firebase);
  var messaging = firebase.messaging();
  messaging.onBackgroundMessage(function (payload) {
    var title = (payload.notification && payload.notification.title) || "BASERA Guardian";
    var body = (payload.notification && payload.notification.body) || "";
    self.registration.showNotification(title, {
      body: body,
      icon: "icons/icon-192.png",
      data: payload.data || {},
    });
  });
  self.addEventListener("notificationclick", function (event) {
    event.notification.close();
    event.waitUntil(clients.openWindow("./"));
  });
})();
