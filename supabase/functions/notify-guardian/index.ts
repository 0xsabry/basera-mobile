// BASERA Edge Function: notify-guardian
//
// Sends a notification to all ACTIVE guardians of a user, over their
// separately registered push endpoints:
//   - platform 'web-fcm'      -> FCM HTTP v1 (guardian PWA, Web Push)
//   - platform 'android-expo' -> Expo Push Service (guardian Android app)
//
// Phase 1 wiring: only type:'test' is invoked anywhere (a "send test
// notification" action). type:'hazard' send logic is implemented here but
// is called by Phase 3 when hazard events exist — payloads NEVER contain
// location data; the guardian client fetches details after authenticating.
//
// Secrets (set with `supabase secrets set`, NEVER committed):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  (auto-injected by Supabase)
//   FCM_SERVICE_ACCOUNT_JSON                  (Firebase service account)
//   FCM_PROJECT_ID
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

interface NotifyBody {
  type: "test" | "hazard";
  ownerUserId: string; // whose guardians to notify
  hazardEventId?: string; // Phase 3: reference only, no location in payload
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// --- FCM HTTP v1 access token from a service-account JSON (RS256 JWT) ---
async function fcmAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${b64(header)}.${b64(claim)}`;
  const pem = (sa.private_key as string)
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${unsigned}.${sigB64}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`FCM token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

async function sendFcmWeb(
  token: string,
  accessToken: string,
  projectId: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data,
          webpush: { notification: { icon: "/icons/icon-192.png" } },
        },
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`FCM send failed (${res.status}): ${text}`);
  }
}

async function sendExpoPush(
  expoToken: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ to: expoToken, title, body, data, sound: "default" }),
  });
  if (!res.ok) throw new Error(`Expo push failed (${res.status})`);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // The caller must be the owner themselves (their JWT) — nobody can
  // trigger notifications for another user's guardians.
  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);

  let body: NotifyBody;
  try {
    body = (await req.json()) as NotifyBody;
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  if (body.ownerUserId !== userData.user.id) {
    return json({ error: "can only notify your own guardians" }, 403);
  }
  if (body.type !== "test" && body.type !== "hazard") {
    return json({ error: "unknown type" }, 400);
  }

  // Active guardians of the owner.
  const { data: links, error: linkErr } = await admin
    .from("guardian_links")
    .select("guardian_id")
    .eq("owner_id", body.ownerUserId)
    .eq("status", "active");
  if (linkErr) return json({ error: linkErr.message }, 500);
  const guardianIds = (links ?? []).map((l: any) => l.guardian_id as string);
  if (guardianIds.length === 0) return json({ sent: 0, reason: "no active guardians" });

  const { data: endpoints, error: epErr } = await admin
    .from("push_endpoints")
    .select("user_id, platform, endpoint")
    .in("user_id", guardianIds);
  if (epErr) return json({ error: epErr.message }, 500);

  const title = body.type === "hazard" ? "BASERA hazard alert" : "BASERA test notification";
  const text =
    body.type === "hazard"
      ? "A hazard event was reported. Open BASERA Guardian to view details."
      : "Test notification from BASERA — guardian alerts are working.";
  const data: Record<string, string> = {
    type: body.type,
    ...(body.hazardEventId ? { hazardEventId: body.hazardEventId } : {}),
  };

  let sent = 0;
  const failures: string[] = [];

  const webEndpoints = (endpoints ?? []).filter((e: any) => e.platform === "web-fcm");
  if (webEndpoints.length > 0) {
    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
    const projectId = Deno.env.get("FCM_PROJECT_ID");
    if (!saRaw || !projectId) {
      failures.push("web-fcm endpoints exist but FCM secrets are not configured");
    } else {
      try {
        const accessToken = await fcmAccessToken(JSON.parse(saRaw));
        for (const ep of webEndpoints) {
          try {
            await sendFcmWeb(ep.endpoint, accessToken, projectId, title, text, data);
            sent++;
          } catch (e) {
            failures.push(`web-fcm: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch (e) {
        failures.push(`web-fcm auth: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  for (const ep of (endpoints ?? []).filter((e: any) => e.platform === "android-expo")) {
    try {
      await sendExpoPush(ep.endpoint, title, text, data);
      sent++;
    } catch (e) {
      failures.push(`android-expo: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return json({ sent, failures });
});
