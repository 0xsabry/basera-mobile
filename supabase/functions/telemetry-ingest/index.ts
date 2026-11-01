/**
 * telemetry-ingest — BASERA installations & OTA adoption intake. (v2)
 *
 * DRAFT — not deployed. Deployment happens only after the owner
 * approves the telemetry migration (see docs/TELEMETRY.md).
 *
 * Security model:
 * - Clients authenticate with a per-installation random secret
 *   (x-installation-secret). Only its SHA-256 hash is stored; the
 *   first request for an installation id pins the hash, and later
 *   requests must match it. Installations are anonymous — no user
 *   identity is accepted or stored.
 * - The function is the ONLY writer. It uses the service role inside
 *   the function runtime (never shipped in the app). Tables have RLS
 *   enabled with no client policies; dashboard reads go through
 *   owner-gated RPC functions (see the telemetry migration).
 * - Abuse controls: hard request-size cap, batch cap, strict field
 *   validation (event-type enum, UUID formats, platform enum,
 *   timestamp sanity), a per-installation hourly event budget, and
 *   idempotent inserts on the unique client_event_id — retries and
 *   replays cannot double-count.
 * - Trust limits (documented): a modified device can forge events
 *   only for its OWN installation (bound to its secret). Counts are
 *   trustworthy for honest clients; the system does not claim to be
 *   tamper-proof against a device's own owner.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EVENT_TYPES = new Set([
  'update_check',
  'update_available',
  'update_downloaded',
  'update_applied',
  'update_failed',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 65536;
const MAX_EVENTS = 50;
const HOURLY_EVENT_BUDGET = 600;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}

function saneTimestamp(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  // Reject client clocks skewed by more than a day; keep server time
  // (received_at) as the authoritative ordering anyway.
  if (Math.abs(Date.now() - t) > 24 * 3600 * 1000) return null;
  return new Date(t).toISOString();
}

function saneUpdateId(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v === 'rollback-to-embedded') return v;
  return typeof v === 'string' && UUID_RE.test(v) ? v : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);

  const installationId = req.headers.get('x-installation-id') ?? '';
  const secret = req.headers.get('x-installation-secret') ?? '';
  if (!UUID_RE.test(installationId) || secret.length < 32 || secret.length > 256) {
    return json({ error: 'invalid_installation_credentials' }, 401);
  }

  let body: { installation?: Record<string, unknown>; events?: unknown[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const facts = body.installation ?? {};
  if (facts.platform !== undefined && facts.platform !== 'android' && facts.platform !== 'ios') {
    return json({ error: 'invalid_platform' }, 400);
  }
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const secretHash = await sha256Hex(secret);

  // Pin-or-verify the installation secret, then refresh heartbeat facts.
  const { data: existing, error: selErr } = await supabase
    .from('app_installations')
    .select('id, secret_hash')
    .eq('id', installationId)
    .maybeSingle();
  if (selErr) return json({ error: 'storage_error' }, 500);

  const factRow = {
    platform: str(facts.platform, 16) ?? 'android',
    os_version: str(facts.os_version, 32),
    app_version: str(facts.app_version, 32),
    version_code:
      typeof facts.version_code === 'number' && facts.version_code >= 0 && facts.version_code < 100000
        ? Math.floor(facts.version_code)
        : null,
    runtime_version: str(facts.runtime_version, 32),
    channel: str(facts.channel, 32),
    current_update_id: saneUpdateId(facts.current_update_id),
    is_embedded_launch: facts.is_embedded_launch === true,
    last_seen_at: new Date().toISOString(),
  };

  if (!existing) {
    const { error } = await supabase
      .from('app_installations')
      .insert({ id: installationId, secret_hash: secretHash, ...factRow });
    if (error) return json({ error: 'storage_error' }, 500);
  } else {
    if (existing.secret_hash !== secretHash) {
      return json({ error: 'invalid_installation_credentials' }, 403);
    }
    // Per-installation hourly budget (registrations/heartbeats with
    // no events are always allowed so last_seen stays truthful).
    if (events.length > 0) {
      const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count, error: cntErr } = await supabase
        .from('app_update_events')
        .select('id', { count: 'exact', head: true })
        .eq('installation_id', installationId)
        .gte('received_at', hourAgo);
      if (cntErr) return json({ error: 'storage_error' }, 500);
      if ((count ?? 0) + events.length > HOURLY_EVENT_BUDGET) {
        return json({ error: 'rate_limited' }, 429);
      }
    }
    const { error } = await supabase
      .from('app_installations')
      .update(factRow)
      .eq('id', installationId);
    if (error) return json({ error: 'storage_error' }, 500);
  }

  // Insert events idempotently (unique client_event_id). Events with
  // malformed ids/types are dropped, not stored.
  let rejected = 0;
  const rows = events
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .filter((e) => {
      const ok =
        typeof e.client_event_id === 'string' &&
        UUID_RE.test(e.client_event_id) &&
        typeof e.event_type === 'string' &&
        EVENT_TYPES.has(e.event_type) &&
        (e.update_id === null || e.update_id === undefined || saneUpdateId(e.update_id) !== null);
      if (!ok) rejected++;
      return ok;
    })
    .map((e) => ({
      client_event_id: e.client_event_id as string,
      installation_id: installationId,
      event_type: e.event_type as string,
      update_id: saneUpdateId(e.update_id),
      app_version: factRow.app_version,
      runtime_version: factRow.runtime_version,
      channel: factRow.channel,
      status: e.status === 'failed' ? 'failed' : 'ok',
      failure_reason: str(e.failure_reason, 300),
      client_ts: saneTimestamp(e.client_ts),
    }));
  let accepted = 0;
  if (rows.length > 0) {
    const { error, count } = await supabase
      .from('app_update_events')
      .upsert(rows, { onConflict: 'client_event_id', ignoreDuplicates: true, count: 'exact' });
    if (error) return json({ error: 'storage_error' }, 500);
    accepted = count ?? rows.length;
  }

  return json({ ok: true, accepted, rejected });
});
