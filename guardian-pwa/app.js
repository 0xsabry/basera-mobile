// BASERA Guardian PWA — app logic.
// Data access is enforced by Supabase RLS on the DEPLOYED project:
// this client only ever sees locations/SOS of wearers who paired with
// this account AND enabled per-link consent for it (see
// docs/SUPABASE_INTEGRATION.md).
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
      "أدخل كود الدعوة الذي أعطاك إياه. يُنشأ الربط فورًا؛ ولن ترى موقعه إلا إذا فعّل هو المشاركة لك.",
    pairCode: "كود الدعوة",
    redeem: "قبول الدعوة",
    peopleTitle: "الأشخاص الذين يشاركون موقعهم معي",
    refresh: "تحديث",
    revokeMine: "إزالة وصولي لهذا الشخص",
    notifyTitle: "تنبيهات الخطر",
    notifyBody: "فعّل التنبيهات لتصلك إشعارات فورية عند حدوث تنبيه خطر (المرحلة 3).",
    enableNotify: "تفعيل التنبيهات",
    signOut: "تسجيل الخروج",
    signedInAs: "مسجل باسم",
    codeInvalid: "الكود غير مكتمل. انسخه كما هو تمامًا.",
    requestSent: "تم الربط. سيظهر الموقع فقط أثناء تفعيله المشاركة لك.",
    noPeople: "لا أحد يشارك موقعه معك حتى الآن. اطلب رمز ربط وأرسله من هنا.",
    updatedAgo: (m) => `آخر تحديث منذ ${m} دقيقة`,
    updatedNow: "تم التحديث الآن",
    stale: (t) => `قديم — آخر ظهور ${t}`,
    stateLastKnown: (m) => `آخر موقع معروف — منذ ${m} دقيقة`,
    stateNoSignal: "لا توجد إشارة موقع حاليًا",
    stateSharingPaused: "مشاركة الموقع متوقفة مؤقتًا",
    stateNoInternet: "لا يوجد اتصال بالإنترنت",
    noLocationYet: "لا يوجد موقع مسجل لهذا الشخص حتى الآن.",
    revoked: "تمت إزالة وصولك. لن ترى موقع هذا الشخص بعد الآن.",
    inviteInvalidOrExpired: "الكود غير صحيح أو انتهت صلاحيته.",
    sosTitle: "تنبيهات الطوارئ",
    sosEmpty: "لا توجد تنبيهات طوارئ حتى الآن.",
    sosActive: "نشط",
    sosResolved: "تمت معالجته",
    webPushNotWired: "إشعارات المتصفح غير مربوطة بخادم بصيرة بعد؛ التنبيهات تظهر هنا أثناء فتح الصفحة.",
    notifyNotConfigured: "التنبيهات غير مهيأة (إعداد Firebase ناقص في config.js). باقي المزايا شغالة.",
    notifyOn: "التنبيهات مفعّلة على المتصفح ده.",
    notifyDenied: "إذن التنبيهات مرفوض من المتصفح.",
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
      "Enter the invite code they gave you. The link is created immediately; you will see their location only while they enable sharing for you.",
    pairCode: "Invite code",
    redeem: "Accept invite",
    peopleTitle: "People sharing their location with me",
    refresh: "Refresh",
    revokeMine: "Remove my access to this person",
    notifyTitle: "Hazard alerts",
    notifyBody: "Enable notifications to receive instant hazard alerts (Phase 3).",
    enableNotify: "Enable notifications",
    signOut: "Sign out",
    signedInAs: "Signed in as",
    codeInvalid: "The code looks incomplete. Copy it exactly as shown.",
    requestSent: "Linked. Location appears only while they share it with you.",
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
    inviteInvalidOrExpired: "The code is invalid or has expired.",
    sosTitle: "SOS alerts",
    sosEmpty: "No SOS alerts yet.",
    sosActive: "Active",
    sosResolved: "Resolved",
    webPushNotWired: "Browser notifications are not connected to the BASERA server yet; alerts appear here while this page is open.",
    notifyNotConfigured: "Notifications are not configured (Firebase config missing). Everything else works.",
    notifyOn: "Notifications are enabled on this browser.",
    notifyDenied: "Notification permission was denied by the browser.",
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
let peopleCache = []; // [{ link, latest, sharingEnabled, name }]
let realtime = null; // window.BASERA_REALTIME instance (live updates)
if (window.BASERA_REALTIME && supabase) {
  realtime = window.BASERA_REALTIME.createGuardianRealtime({
    client: supabase,
    onLocation: (wearerId, row) => {
      const person = peopleCache.find((p) => p.link.subject_user_id === wearerId);
      if (person) {
        person.latest = row;
        renderPeople();
        if (selectedLink && selectedLink.subject_user_id === wearerId) {
          void selectPerson(person.link, row, person.sharingEnabled);
        }
      }
    },
    onSos: (row) => {
      renderSos([row], true);
      status(s().sosTitle);
    },
  });
}
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
  show("sosSection", signedIn);
  show("sessionSection", signedIn);
  if (signedIn) {
    $("whoami").textContent = `${s().signedInAs}: ${session.user.email || session.user.id}`;
    await refreshPeople();
  } else if (realtime) {
    realtime.unsubscribe();
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
  if (realtime) realtime.unsubscribe();
  peopleCache = [];
  await supabase.auth.signOut();
  await refreshSession();
});

// ------------------------------------------------------------------ pairing
$("redeemBtn").addEventListener("click", async () => {
  error("");
  status("");
  // Deployed invite codes are dashed hex tokens — submit exactly what
  // was issued (trimmed), never a digit-only reinterpretation.
  const code = $("pairCode").value.trim().replace(/\s+/g, "");
  if (code.length < 8) {
    error(s().codeInvalid);
    return;
  }
  const { error: fnError } = await supabase.functions.invoke("accept-guardian-invite", {
    body: { invite_code: code },
  });
  if (fnError) {
    let serverCode = "";
    try {
      const body = await fnError.context.json();
      serverCode = (body && body.error) || "";
    } catch {
      /* wrapper error only */
    }
    if (serverCode === "invalid_or_expired_invite") {
      error(s().inviteInvalidOrExpired);
    } else {
      error(lang === "en" ? fnError.message : s().genericError);
    }
    return;
  }
  $("pairCode").value = "";
  status(s().requestSent);
  await refreshPeople();
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

// DEPLOYED contract (docs/SUPABASE_INTEGRATION.md): links key the
// wearer as subject_user_id; consent flags live ON the link; locations
// are ONE latest row per wearer in guardian_locations with
// latitude/longitude columns, readable only while the link's
// location_sharing_enabled is true (RLS enforces it — an empty result
// is the honest state, never an error to hide).
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
      .select("id, subject_user_id, guardian_user_id, location_sharing_enabled, sos_sharing_enabled, created_at")
      .eq("guardian_user_id", session.user.id);
    if (linkErr) {
      if (isNetworkError(linkErr)) {
        showNoInternet();
        return;
      }
      error(lang === "en" ? linkErr.message : s().genericError);
      return;
    }
    if (!links || links.length === 0) {
      peopleCache = [];
      list.innerHTML = `<p>${s().noPeople}</p>`;
      $("revokeBtn").hidden = true;
      if (realtime) realtime.setWearers([]);
      renderSos([], false);
      return;
    }
    const ownerIds = links.map((l) => l.subject_user_id);
    const [profilesRes, latestRes] = await Promise.all([
      supabase.from("profiles").select("id, display_name").in("id", ownerIds),
      supabase.from("guardian_locations").select("*").in("subject_user_id", ownerIds),
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
    const latestOf = (id) => (latest || []).find((l) => l.subject_user_id === id) || null;

    peopleCache = links.map((link) => ({
      link,
      latest: latestOf(link.subject_user_id),
      // The wearer controls this per link; RLS already hides the row
      // when it is false, and the flag drives the freshness state.
      sharingEnabled: link.location_sharing_enabled === true,
      name: nameOf(link.subject_user_id),
    }));
    renderPeople();
    if (realtime) realtime.setWearers(ownerIds);
    await loadSos(ownerIds);
    const first = peopleCache[0];
    if (first) await selectPerson(first.link, first.latest, first.sharingEnabled);
  } catch (err) {
    if (isNetworkError(err)) {
      showNoInternet();
      return;
    }
    error(lang === "en" && err && err.message ? err.message : s().genericError);
  }
}

function renderPeople() {
  const list = $("peopleList");
  list.innerHTML = "";
  for (const person of peopleCache) {
    const fresh = freshnessDisplay(person.latest, person.sharingEnabled);
    const div = document.createElement("div");
    div.className = "person";
    div.innerHTML = `<strong></strong><br/><span></span>`;
    div.querySelector("strong").textContent = person.name;
    const span = div.querySelector("span");
    span.textContent = fresh.text;
    span.className = fresh.className;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary";
    btn.textContent = s().refresh;
    btn.addEventListener("click", () => void selectPerson(person.link, person.latest, person.sharingEnabled));
    div.appendChild(document.createElement("br"));
    div.appendChild(btn);
    list.appendChild(div);
  }
}

async function loadSos(ownerIds) {
  const { data, error: sosErr } = await supabase
    .from("sos_alerts")
    .select("*")
    .in("subject_user_id", ownerIds)
    .order("triggered_at", { ascending: false })
    .limit(20);
  if (sosErr) return; // RLS-gated per link (sos_sharing_enabled); absence is honest
  renderSos(data || [], false);
}

function renderSos(rows, prepend) {
  const list = $("sosList");
  if (!list) return;
  if (!prepend) list.innerHTML = "";
  if (!prepend && rows.length === 0) {
    list.innerHTML = `<p>${s().sosEmpty}</p>`;
    return;
  }
  if (prepend && list.querySelector("p")) list.innerHTML = "";
  for (const row of rows) {
    const person = peopleCache.find((p) => p.link.subject_user_id === row.subject_user_id);
    const div = document.createElement("div");
    div.className = "person";
    const name = person ? person.name : row.subject_user_id;
    const when = row.triggered_at ? new Date(row.triggered_at).toLocaleString() : "";
    const state = row.status === "resolved" ? s().sosResolved : s().sosActive;
    div.innerHTML = `<strong></strong><br/><span></span>`;
    div.querySelector("strong").textContent = `${s().sosTitle} — ${name}`;
    div.querySelector("span").textContent = `${when} — ${state}`;
    if (prepend && list.firstChild) list.insertBefore(div, list.firstChild);
    else list.appendChild(div);
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
  // Latest-only in the deployed model — there is no history track.
  if (polyline) {
    polyline.remove();
    polyline = null;
  }
  if (latest) {
    if (marker) marker.remove();
    marker = L.marker([latest.latitude, latest.longitude]).addTo(map);
    if (circle) circle.remove();
    circle = null;
    if (typeof latest.accuracy_m === "number" && Number.isFinite(latest.accuracy_m) && latest.accuracy_m > 0) {
      circle = L.circle([latest.latitude, latest.longitude], { radius: latest.accuracy_m }).addTo(map);
    }
    map.setView([latest.latitude, latest.longitude], 15);
  } else {
    // No latest row visible (sharing off for me / revoked / no fix
    // yet): NEVER render a marker.
    if (marker) marker.remove();
    marker = null;
    if (circle) circle.remove();
    circle = null;
  }
  setTimeout(() => map.invalidateSize(), 50);
}
$("refreshBtn").addEventListener("click", () => void refreshPeople());

$("revokeBtn").addEventListener("click", async () => {
  if (!selectedLink) return;
  // Unlink = delete my link row (either party may; RLS decides). The
  // .select() verifies a row was actually removed — no fake success.
  const { data, error: delError } = await supabase
    .from("guardian_links")
    .delete()
    .eq("id", selectedLink.id)
    .select("id");
  if (delError || !data || data.length === 0) {
    error(lang === "en" && delError ? delError.message : s().genericError);
    return;
  }
  status(s().revoked);
  selectedLink = null;
  await refreshPeople();
});

// Realtime (realtime.js) delivers live location + SOS updates; this
// light polling remains as a fallback for dropped sockets. Both paths
// render the same server truth — polling never fabricates freshness.
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
  // DEPLOYED contract: there is NO web-push endpoint table in the
  // owner's project (user_push_tokens holds Expo tokens for the
  // Android app; its platform check rejects web tokens). The browser
  // permission + FCM token exist locally only — say so honestly
  // instead of claiming a server registration that did not happen.
  status(s().webPushNotWired);
}
$("notifyBtn").addEventListener("click", () => void enableNotifications());

// ---------------------------------------------------------------------- init
applyLang();
void refreshSession();
