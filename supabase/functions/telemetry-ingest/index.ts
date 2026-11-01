/**
 * telemetry-ingest — BASERA installations & OTA adoption intake. (v3)
 *
 * DRAFT — not deployed. Deployment happens only after the owner's
 * final review (see docs/TELEMETRY.md).
 *
 * The function is a thin, hardened transport in front of the database
 * function public.telemetry_ingest(), which performs ALL writes in a
 * single transaction (per-installation advisory lock, pin-or-verify
 * secret, strict per-event classification, atomic hourly budget).
 *
 * Transport responsibilities here:
 * - Stream the request body with a hard 64KB BYTE cap enforced while
 *   reading (Content-Length is never trusted; oversized bodies are
 *   aborted mid-stream, never fully consumed).
 * - Reject batches of more than 50 events outright (HTTP 400) so the
 *   client keeps its entire queue — events are never silently sliced.
 * - Validate batch-level facts (a failure rejects the request, the
 *   client keeps its queue).
 * - SHA-256 the installation secret and call the RPC as service role
 *   (the only role with EXECUTE on telemetry_ingest).
 *
 * Per-event outcomes come back as verdicts: accepted + duplicates are
 * removed from the client queue; rejected events (with reasons) are
 * moved by the client to a local dead-letter store; a failed REQUEST
 * (any non-200) keeps the whole queue for retry.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  BodyTooLargeError,
  MAX_EVENTS,
  checkBatch,
  mapIngestResult,
  readBodyWithCap,
  validateFacts,
} from './core.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const installationId = req.headers.get('x-installation-id') ?? '';
  const secret = req.headers.get('x-installation-secret') ?? '';
  if (!UUID_RE.test(installationId) || secret.length < 32 || secret.length > 256) {
    return json({ error: 'invalid_installation_credentials' }, 401);
  }

  let rawBody: string;
  try {
    rawBody = await readBodyWithCap(req.body);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json({ error: 'payload_too_large' }, 413);
    return json({ error: 'body_read_failed' }, 400);
  }

  let body: { installation?: Record<string, unknown>; events?: unknown[] };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const events = Array.isArray(body.events) ? body.events : [];
  const batchError = checkBatch(events);
  if (batchError) {
    // Hard reject: the client keeps ALL queued events. Slicing here
    // would silently drop the tail and corrupt the client's queue
    // accounting.
    return json({ error: batchError.error, max: MAX_EVENTS, received: batchError.received }, 400);
  }

  const checked = validateFacts(body.installation ?? {});
  if ('error' in checked) return json({ error: checked.error }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const { data, error } = await supabase.rpc('telemetry_ingest', {
    p_installation_id: installationId,
    p_secret_hash: await sha256Hex(secret),
    ...checked.facts,
    p_events: events,
  });
  if (error) return json({ error: 'storage_error' }, 500);

  const mapped = mapIngestResult(data);
  return json(mapped.body, mapped.status);
});
