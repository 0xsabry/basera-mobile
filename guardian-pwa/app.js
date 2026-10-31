// BASERA Guardian PWA — app logic.
// Data access is enforced by Supabase RLS: this client only ever sees
// locations of people who approved THIS account as an active guardian.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";

const STRINGS = {
  ar: {
    appTitle: "بصيرة — الوصي",
    notConfiguredTitle: "الخدمة غير مهيأة",
    notConfiguredBody: "لم يتم إعداد اتصال الخادم بعد (config.js). راجع docs/GUARDIAN_SETUP.md.",
    signInTitle: "تسجيل الدخول",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    signIn: "دخول",
    signUp: "إنشاء حساب",
    redeemTitle: "ربط بشخص يشارك موقعه معك",
    redeemBody:
      "أدخل كود الربط الذي أعطاك إياه. سيُنشئ الكود طلبًا معلّقًا فقط — ولن ترى أي موقع حتى يوافق هو على الطلب من تطبيقه.",
    pairCode: "كود الربط (6 أرقام)",
    redeem: "إرسال طلب الربط",
    peopleTitle: "الأشخاص الذين يشاركون موقعهم معي",
    refresh: "تحديث",
    revokeMine: "إزالة وصولي لهذا الشخص",
    notifyTitle: "تنبيهات الخطر",
    notifyBody: "فعّل التنبيهات لتصلك إشعارات فورية عند حدوث تنبيه خطر (المرحلة 3).",
    enableNotify: "تفعيل التنبيهات",
    testNotify: "إرسال تنبيه تجريبي لأوصيائي",
    signOut: "تسجيل الخروج",
    signedInAs: "مسجل باسم",
    codeInvalid: "الكود لازم يكون 6 أرقام.",
    requestSent: "اتُبعت الطلب. هتقدر تشوف الموقع بس بعد ما يوافق من تطبيقه.",
    noPeople: "لا أحد يشارك موقعه معك حتى الآن. اطلب رمز ربط وأرسله من هنا.",
    updatedAgo: (m) => `آخر تحديث منذ ${m} دقيقة`,
    updatedNow: "تم التحديث الآن",
    stale: (t) => `قديم — آخر ظهور ${t}`,
    stateLastKnown: (m) => `آخر موقع معروف — منذ ${m} دقيقة`,
    stateNoSignal: "لا توجد إشارة موقع حاليًا",
    stateSharingPaused: "مشاركة الموقع متوقفة مؤقتًا",
    stateNoInternet: "لا يوجد اتصال بالإنترنت",
    noLocationYet: "لا يوجد موقع مسجل لهذا الشخص حتى الآن.",
    revoked: "تمت إزالة وصولك. مش هتشوف موقع الشخص ده تاني.",
    notifyNotConfigured: "التنبيهات غير مهيأة (إعداد Firebase ناقص في config.js). باقي المزايا شغالة.",
    notifyOn: "التنبيهات مفعّلة على المتصفح ده.",
    notifyDenied: "إذن التنبيهات مرفوض من المتصفح.",
    testSent: "اتبعت التنبيه التجريبي لأوصيائك.",
    genericError: "حصلت مشكلة. حاول تاني.",
  },
  en: {
    appTitle: "BASERA — Guardian",
    notConfiguredTitle: "Service not configured",
    notConfiguredBody: "Server connection is not set up yet (config.js). See docs/GUARDIAN_SETUP.md.",
    signInTitle: "Sign in",
    email: "Email",
    password: "Password",
    signIn: "Sign in",
    signUp: "Create account",
    redeemTitle: "Link to someone sharing with you",
    redeemBody:
      "Enter the pairing code they gave you. The code only creates a pending request — you will see no location until they approve it in their app.",
    pairCode: "Pairing code (6 digits)",
    redeem: "Send link request",
    peopleTitle: "People sharing their location with me",
    refresh: "Refresh",
    revokeMine: "Remove my access to this person",
    notifyTitle: "Hazard alerts",
    notifyBody: "Enable notifications to receive instant hazard alerts (Phase 3).",
    enableNotify: "Enable notifications",
    testNotify: "Send a test alert to my guardians",
    signOut: "Sign out",
    signedInAs: "Signed in as",
    codeInvalid: "The code must be 6 digits.",
    requestSent: "Request sent. You can see the location only after they approve it in their app.",
    noPeople: "Nobody is sharing with you yet. Ask for a pairing code and send it here.",
    updatedAgo: (m) => `Updated ${m} min ago`,
    updatedNow: "Updated just now",
    stale: (t) => `Stale — last seen ${t}`,
    stateLastKnown: (m) => `Last known location — ${m} min ago`,
    stateNoSignal: "No location signal right now",
    stateSharingPaused: "Location sharing is paused",
    stateNoInternet: "No internet connection",
    noLocationYet: "No location recorded for this person yet.",
    revoked: "Your access was removed. You will no longer see this person's location.",
    notifyNotConfigured: "Notifications are not configured (Firebase config missing). Everything else works.",
    notifyOn: "Notifications are enabled on this browser.",
    notifyDenied: "Notification permission was denied by the browser.",
    testSent: "Test alert sent to your guardians.",
    genericError: "Something went wrong. Try again.",
  },
};

let lang = localStorage.getItem("basera-guardian-lang") || "ar";
const s = () => STRINGS[lang];
const $ = (id) => document.getElementById(id);

function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  $("appTitle").textContent = s().appTitle;
  $("langToggle").textContent = lang === "ar" ? "English" : "العربية";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (typeof s()[key] === "string") el.textContent = s()[key];
  });
}
$("langToggle").addEventListener("click", () => {
  lang = lang === "ar" ? "en" : "ar";
  localStorage.setItem("basera-guardian-lang", lang);
  applyLang();
  void refreshPeople();
});

function status(msg) {
  $("statusMsg").textContent = msg || "";
}
function error(msg) {
  $("errorMsg").textContent = msg || "";
}

// ------------------------------------------------------------ service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(() => undefined);
}

// ------------------------------------------------------------------- config
const cfg = window.BASERA_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
let supabase = null;
if (configured) {
  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
} else {
  $("configSection").hidden = false;
}

let session = null;
let selectedLink = null; // guardian_links row for the selected owner
let map = null;
let marker = null;
let circle = null;
let polyline = null;

function show(id, visible) {
  $(id).hidden = !visible;
}

async function refreshSession() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  session = data.session;
  const signedIn = Boolean(session);
  show("authSection", !signedIn);
  show("redeemSection", signedIn);
  show("peopleSection", signedIn);
  show("notifySection", signedIn);
  show("sessionSection", signedIn);
  if (signedIn) {
    $("whoami").textContent = `${s().signedInAs}: ${session.user.email || session.user.id}`;
    await refreshPeople();
  }
}

// --------------------------------------------------------------------- auth
async function auth(mode) {
  error("");
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) return;
  const res =
    mode === "up"
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
  if (res.error) {
    error(lang === "en" ? res.error.message : s().genericError);
    return;
  }
  await refreshSession();
}
$("signInBtn").addEventListener("click", () => void auth("in"));
$("signUpBtn").addEventListener("click", () => void auth("up"));
$("signOutBtn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  await refreshSession();
});

// ------------------------------------------------------------------ pairing
$("redeemBtn").addEventListener("click", async () => {
  error("");
  status("");
  const code = $("pairCode").value.replace(/\D/g, "");
  if (code.length !== 6) {
    error(s().codeInvalid);
    return;
  }
  const { error: rpcError } = await supabase.rpc("redeem_pairing_code", { p_code: code });
  if (rpcError) {
    error(lang === "en" ? rpcError.message : s().genericError);
    return;
  }
  $("pairCode").value = "";
  status(s().requestSent);
});

// ------------------------------------------------------------------- people
// Freshness state model lives in freshness.js (window.BASERA_FRESHNESS),
// loaded as a classic script before this module. States:
// no-internet / sharing-paused / no-signal / updated-recently /
// last-known / stale — each gets distinct text + a distinct CSS class.
function isNetworkError(err) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = String((err && err.message) || err || "");
  return /failed to fetch|network|fetch failed|load failed|networkerror/i.test(msg);
}

function showNoInternet() {
  error("");
  const el = $("freshness");
  el.textContent = s().stateNoInternet;
  el.className = "msg freshness-no-internet";
}

function freshnessDisplay(latest, sharingEnabled) {
  const classifier =
    typeof window !== "undefined" && window.BASERA_FRESHNESS
      ? window.BASERA_FRESHNESS.classifyGuardianLocation
      : null;
  if (!classifier) {
    // Fallback if freshness.js failed to load: never claim a location
    // we cannot classify.
    return latest
      ? { state: "stale", text: s().stale(new Date(latest.recorded_at || latest.updated_at).toLocaleString()), className: "freshness-stale", ageMinutes: null }
      : { state: "no-signal", text: s().stateNoSignal, className: "freshness-no-signal", ageMinutes: null };
  }
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  const { state, ageMinutes } = classifier({
    now: Date.now(),
    latest: latest || null,
    sharingEnabled: typeof sharingEnabled === "boolean" ? sharingEnabled : null,
    online,
  });
  const stamp = latest ? latest.recorded_at || latest.updated_at : null;
  let text;
  switch (state) {
    case "updated-recently":
      text =
        ageMinutes != null && ageMinutes >= 1
          ? s().updatedAgo(Math.round(ageMinutes))
          : s().updatedNow;
      break;
    case "last-known":
      text =
        typeof s().stateLastKnown === "function"
          ? s().stateLastKnown(Math.round(ageMinutes || 0))
          : s().stateLastKnown;
      break;
    case "stale":
      text = stamp ? s().stale(new Date(stamp).toLocaleString()) : s().stateNoSignal;
      break;
    case "no-signal":
      text = s().stateNoSignal;
      break;
    case "sharing-paused":
      text = s().stateSharingPaused;
      break;
    case "no-internet":
      text = s().stateNoInternet;
      break;
    default:
      text = s().stateNoSignal;
  }
  return { state, text, className: `freshness-${state}`, ageMinutes };
}

async function refreshPeople() {
  if (!supabase || !session) return;
  const list = $("peopleList");
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    showNoInternet();
    return;
  }
  try {
    const { data: links, error: linkErr } = await supabase
      .from("guardian_links")
      .select("id, owner_id, status, created_at")
      .eq("guardian_id", session.user.id)
      .eq("status", "active");
    if (linkErr) {
      if (isNetworkError(linkErr)) {
        showNoInternet();
        return;
      }
      error(lang === "en" ? linkErr.message : s().genericError);
      return;
    }
    list.innerHTML = "";
    if (!links || links.length === 0) {
      list.innerHTML = `<p>${s().noPeople}</p>`;
      $("revokeBtn").hidden = true;
      return;
    }
    const ownerIds = links.map((l) => l.owner_id);
    const [profilesRes, latestRes] = await Promise.all([
      supabase.from("profiles").select("id, display_name, sharing_enabled").in("id", ownerIds),
      supabase.from("latest_locations").select("*").in("user_id", ownerIds),
    ]);
    const queryErr = profilesRes.error || latestRes.error;
    if (queryErr) {
      if (isNetworkError(queryErr)) {
        showNoInternet();
        return;
      }
      error(lang === "en" ? queryErr.message : s().genericError);
      return;
    }
    const profiles = profilesRes.data;
    const latest = latestRes.data;
    const nameOf = (id) => (profiles || []).find((p) => p.id === id)?.display_name || id;
    const sharingOf = (id) => {
      const p = (profiles || []).find((pr) => pr.id === id);
      return p && typeof p.sharing_enabled === "boolean" ? p.sharing_enabled : null;
    };
    const latestOf = (id) => (latest || []).find((l) => l.user_id === id) || null;

    for (const link of links) {
      const loc = latestOf(link.owner_id);
      const sharingEnabled = sharingOf(link.owner_id);
      const fresh = freshnessDisplay(loc, sharingEnabled);
      const div = document.createElement("div");
      div.className = "person";
      div.innerHTML = `<strong></strong><br/><span></span>`;
      div.querySelector("strong").textContent = nameOf(link.owner_id);
      const span = div.querySelector("span");
      span.textContent = fresh.text;
      span.className = fresh.className;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary";
      btn.textContent = s().refresh;
      btn.addEventListener("click", () => void selectPerson(link, loc, sharingEnabled));
      div.appendChild(document.createElement("br"));
      div.appendChild(btn);
      list.appendChild(div);
    }
    const first = links[0];
    await selectPerson(first, latestOf(first.owner_id), sharingOf(first.owner_id));
  } catch (err) {
    if (isNetworkError(err)) {
      showNoInternet();
      return;
    }
    error(lang === "en" && err && err.message ? err.message : s().genericError);
  }
}

async function selectPerson(link, latest, sharingEnabled) {
  selectedLink = link;
  $("revokeBtn").hidden = false;
  // Freshness line reflects the classifier even without a map / location.
  const fresh = freshnessDisplay(latest || null, sharingEnabled);
  $("freshness").textContent = fresh.text;
  $("freshness").className = `msg ${fresh.className}`;
  if (!window.L) return;
  if (!map) {
    map = L.map("map").setView([30.0444, 31.2357], 12);
    L.tileLayer(cfg.mapTileUrl || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: Number.isFinite(cfg.mapMaxZoom) ? cfg.mapMaxZoom : 19,
      attribution:
        cfg.mapAttribution ||
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }
  // 24h history (RLS returns rows only while the link is active).
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: points } = await supabase
    .from("location_points")
    .select("lat, lng, recorded_at")
    .eq("user_id", link.owner_id)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true })
    .limit(500);
  const latlngs = (points || []).map((p) => [p.lat, p.lng]);
  if (polyline) polyline.remove();
  if (latlngs.length > 1) {
    polyline = L.polyline(latlngs, { color: "#0B3D2E" }).addTo(map);
  }
  if (latest) {
    if (marker) marker.remove();
    marker = L.marker([latest.lat, latest.lng]).addTo(map);
    if (circle) circle.remove();
    circle = null;
    if (typeof latest.accuracy_m === "number" && Number.isFinite(latest.accuracy_m) && latest.accuracy_m > 0) {
      circle = L.circle([latest.lat, latest.lng], { radius: latest.accuracy_m }).addTo(map);
    }
    map.setView([latest.lat, latest.lng], 15);
  } else {
    // No latest row (sharing off/revoked or no fix yet): NEVER render a marker.
    if (marker) marker.remove();
    marker = null;
    if (circle) circle.remove();
    circle = null;
    if (latlngs.length > 0) {
      map.setView(latlngs[latlngs.length - 1], 15);
    }
  }
  setTimeout(() => map.invalidateSize(), 50);
}
$("refreshBtn").addEventListener("click", () => void refreshPeople());

$("revokeBtn").addEventListener("click", async () => {
  if (!selectedLink) return;
  const { error: rpcError } = await supabase.rpc("revoke_link", { p_link_id: selectedLink.id });
  if (rpcError) {
    error(lang === "en" ? rpcError.message : s().genericError);
    return;
  }
  status(s().revoked);
  selectedLink = null;
  await refreshPeople();
});

// Light polling while the page is open (Realtime can replace this later).
setInterval(() => {
  if (session && !document.hidden) void refreshPeople();
}, 30_000);

// ------------------------------------------------------------- notifications
async function enableNotifications() {
  error("");
  if (!cfg.firebase || !cfg.vapidKey) {
    status(s().notifyNotConfigured);
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    status(s().notifyDenied);
    return;
  }
  // Firebase modular SDK from the official CDN.
  const { initializeApp } = await import(
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js"
  );
  const { getMessaging, getToken } = await import(
    "https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging.js"
  );
  const app = initializeApp(cfg.firebase);
  const messaging = getMessaging(app);
  const registration = await navigator.serviceWorker.register("firebase-messaging-sw.js");
  const token = await getToken(messaging, {
    vapidKey: cfg.vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) {
    error(s().genericError);
    return;
  }
  // Separately registered WEB endpoint (platform 'web-fcm'). The FCM
  // server key never appears in this client — sending is server-side.
  const { error: upErr } = await supabase.from("push_endpoints").upsert(
    { user_id: session.user.id, platform: "web-fcm", endpoint: token, updated_at: new Date().toISOString() },
    { onConflict: "user_id,platform,endpoint" },
  );
  if (upErr) {
    error(lang === "en" ? upErr.message : s().genericError);
    return;
  }
  status(s().notifyOn);
}
$("notifyBtn").addEventListener("click", () => void enableNotifications());

$("testNotifyBtn").addEventListener("click", async () => {
  error("");
  const res = await fetch(`${cfg.supabaseUrl}/functions/v1/notify-guardian`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: cfg.supabaseAnonKey,
    },
    body: JSON.stringify({ type: "test", ownerUserId: session.user.id }),
  });
  if (!res.ok) {
    error(s().genericError);
    return;
  }
  status(s().testSent);
});

// ---------------------------------------------------------------------- init
applyLang();
void refreshSession();
