/**
 * telemetry-ingest — BASERA installations & OTA adoption intake.
 *
 * DRAFT — not deployed. Deployment happens only after the owner
 * approves the telemetry migration (see docs/TELEMETRY.md).
 *
 * Security model:
 * - Clients authenticate with a per-installation random secret
 *   (x-installation-secret). Only its SHA-256 hash is stored; the
 *   first request for an installation id pins the hash, later
 *   requests must match it. Installations are anonymous — no user
 *   identity is accepted or stored.
 * - The function is the ONLY writer. It uses the service role inside
 *   the function runtime (never shipped in the app). Tables have RLS
 *   enabled with no client policies; dashboard reads go through
 *   owner-gated RPC functions (see the telemetry migration).
 * - Events carry client-generated UUIDs with a unique constraint:
 *   retries and replays are idempotent and cannot double-count.
 * - Payloads are strictly validated (event-type enum, caps on batch
 *   size and string lengths) to limit tampering and junk.
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
const MAX_EVENTS = 50;

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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const installationId = req.headers.get('x-installation-id') ?? '';
  const secret = req.headers.get('x-installation-secret') ?? '';
  if (!UUID_RE.test(installationId) || secret.length < 32 || secret.length > 256) {
    return json({ error: 'invalid_installation_credentials' }, 401);
  }

  let body: { installation?: Record<string, unknown>; events?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const facts = body.installation ?? {};
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
    current_update_id: str(facts.current_update_id, 64),
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
    const { error } = await supabase
      .from('app_installations')
      .update(factRow)
      .eq('id', installationId);
    if (error) return json({ error: 'storage_error' }, 500);
  }

  // Insert events idempotently (unique client_event_id).
  let accepted = 0;
  const rows = events
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .filter(
      (e) =>
        typeof e.client_event_id === 'string' &&
        UUID_RE.test(e.client_event_id) &&
        typeof e.event_type === 'string' &&
        EVENT_TYPES.has(e.event_type),
    )
    .map((e) => ({
      client_event_id: e.client_event_id as string,
      installation_id: installationId,
      event_type: e.event_type as string,
      update_id: str(e.update_id, 64),
      app_version: factRow.app_version,
      runtime_version: factRow.runtime_version,
      channel: factRow.channel,
      status: e.status === 'failed' ? 'failed' : 'ok',
      failure_reason: str(e.failure_reason, 300),
      client_ts: typeof e.client_ts === 'string' ? e.client_ts : null,
    }));
  if (rows.length > 0) {
    const { error, count } = await supabase
      .from('app_update_events')
      .upsert(rows, { onConflict: 'client_event_id', ignoreDuplicates: true, count: 'exact' });
    if (error) return json({ error: 'storage_error' }, 500);
    accepted = count ?? rows.length;
  }

  return json({ ok: true, accepted });
});
