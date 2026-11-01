/**
 * telemetry-ingest core — runtime-agnostic request handling (v5).
 *
 * Everything except the Supabase client wiring lives here so the full
 * request path is testable under Deno with a fake RPC: method and
 * credential gates, the streaming byte cap, strict body shape,
 * batch gate, fact validation, secret hashing, and verdict mapping.
 * index.ts only injects the real rpc call.
 *
 * Request contract (any violation = a non-200 response, and the
 * client keeps its ENTIRE queue — nothing is acknowledged):
 * - POST only.
 * - Headers: x-installation-id (UUID), x-installation-secret (32–256).
 * - Body: a JSON OBJECT (null, primitives and arrays are rejected),
 *   streamed with a hard 64KB byte cap.
 * - `events` is REQUIRED and must be an array (never coerced from a
 *   missing/wrong-typed value); more than 50 entries reject the batch.
 * - `installation`, when present, must be an object with in-enum,
 *   in-range fields.
 * A Supabase user session is NOT required: the client sends the
 * publishable key in the apikey header only (never as a Bearer
 * token); the platform gateway validates the key. The installation
 * secret is the actual credential.
 */

export const MAX_BODY_BYTES = 65536;
export const MAX_EVENTS = 50;

export class BodyTooLargeError extends Error {
  constructor() {
    super('payload_too_large');
  }
}

/**
 * Read a request body as a byte-counted stream, aborting as soon as
 * the cap is exceeded — the body is never fully consumed first, and
 * Content-Length is never trusted (it may be absent or lying).
 */
export async function readBodyWithCap(
  body: ReadableStream<Uint8Array> | null,
  cap: number = MAX_BODY_BYTES,
): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export interface IngestFacts {
  platform?: unknown;
  os_version?: unknown;
  app_version?: unknown;
  version_code?: unknown;
  runtime_version?: unknown;
  channel?: unknown;
  current_update_id?: unknown;
  is_embedded_launch?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Batch-level fact validation. Invalid facts reject the whole REQUEST
 * (HTTP 400) so the client keeps its queue intact — facts are never
 * silently coerced and then stored.
 * Returns an error code, or the normalized facts for the RPC call.
 */
export function validateFacts(
  facts: IngestFacts,
): { error: string } | { facts: Record<string, unknown> } {
  if (facts.platform !== undefined && facts.platform !== 'android' && facts.platform !== 'ios') {
    return { error: 'invalid_platform' };
  }
  const vc = facts.version_code;
  if (vc !== undefined && vc !== null) {
    if (typeof vc !== 'number' || !Number.isInteger(vc) || vc < 0 || vc >= 100000) {
      return { error: 'invalid_version_code' };
    }
  }
  for (const [key, max] of [
    ['os_version', 32],
    ['app_version', 32],
    ['runtime_version', 32],
    ['channel', 32],
  ] as const) {
    const v = facts[key];
    if (v !== undefined && v !== null && str(v, max) === null) {
      return { error: `invalid_${key}` };
    }
  }
  const cuid = facts.current_update_id;
  if (
    cuid !== undefined &&
    cuid !== null &&
    cuid !== 'rollback-to-embedded' &&
    !(typeof cuid === 'string' && UUID_RE.test(cuid))
  ) {
    return { error: 'invalid_current_update_id' };
  }
  // is_embedded_launch is tri-state: a present value MUST be a real
  // boolean (anything else rejects the request); an absent value
  // stays UNKNOWN (null) end-to-end — it is never coerced to false.
  const emb = facts.is_embedded_launch;
  if (emb !== undefined && emb !== null && typeof emb !== 'boolean') {
    return { error: 'invalid_is_embedded_launch' };
  }
  return {
    facts: {
      p_platform: str(facts.platform, 16),
      p_os_version: str(facts.os_version, 32),
      p_app_version: str(facts.app_version, 32),
      p_version_code: typeof vc === 'number' ? vc : null,
      p_runtime_version: str(facts.runtime_version, 32),
      p_channel: str(facts.channel, 32),
      p_current_update_id: typeof cuid === 'string' ? cuid : null,
      p_is_embedded_launch: typeof emb === 'boolean' ? emb : null,
    },
  };
}

/**
 * Batch-size gate: more than MAX_EVENTS events rejects the WHOLE
 * batch (the client keeps every queued event). Events are never
 * sliced — a silent tail-drop would corrupt queue accounting.
 */
export function checkBatch(events: unknown[]): { error: string; received: number } | null {
  if (events.length > MAX_EVENTS) {
    return { error: 'batch_too_large', received: events.length };
  }
  return null;
}

/** Map the database verdict to the HTTP response the client expects. */
export function mapIngestResult(result: unknown): { status: number; body: Record<string, unknown> } {
  const r = (result ?? {}) as Record<string, unknown>;
  if (
    r.error === 'secret_mismatch' ||
    r.error === 'invalid_installation_credentials' ||
    r.error === 'unknown_installation'
  ) {
    return { status: 403, body: { error: r.error } };
  }
  if (r.error === 'registration_throttled') {
    // Transient: the client keeps its queue and retries later.
    return { status: 429, body: { error: 'registration_throttled' } };
  }
  if (typeof r.error === 'string') {
    return { status: 500, body: { error: 'storage_error' } };
  }
  return {
    status: 200,
    body: {
      ok: true,
      accepted: Array.isArray(r.accepted) ? r.accepted : [],
      duplicates: Array.isArray(r.duplicates) ? r.duplicates : [],
      rejected: Array.isArray(r.rejected) ? r.rejected : [],
      // The id-pool top-up MUST reach the client: without it the
      // pool drains after the bootstrap grant and no further event
      // can ever be assigned an id. (Caught by the real-gateway
      // smoke test; the fake-RPC tests now pin this passthrough.)
      event_id_pool: Array.isArray(r.event_id_pool) ? r.event_id_pool : [],
    },
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type RpcCall = (
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

export interface IngestRpcs {
  ingest: RpcCall;
  bootstrap: RpcCall;
}

/**
 * The full request handler. Two modes:
 * - Bootstrap (header `x-telemetry-bootstrap: 1`): the client has no
 *   identity yet — the app contains no CSPRNG, so the SERVER issues
 *   one (telemetry_bootstrap). Body: { installation: facts } only;
 *   an `events` member is a protocol error.
 * - Ingest (default): id + secret headers, strict envelope, verdict.
 */
export async function handleIngestRequest(req: Request, rpcs: IngestRpcs): Promise<Response> {
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const isBootstrap = req.headers.get('x-telemetry-bootstrap') === '1';

  const installationId = req.headers.get('x-installation-id') ?? '';
  const secret = req.headers.get('x-installation-secret') ?? '';
  if (!isBootstrap) {
    if (!UUID_RE.test(installationId) || secret.length < 32 || secret.length > 256) {
      return json({ error: 'invalid_installation_credentials' }, 401);
    }
  }

  let rawBody: string;
  try {
    rawBody = await readBodyWithCap(req.body);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json({ error: 'payload_too_large' }, 413);
    return json({ error: 'body_read_failed' }, 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  // Strict body shape: the root must be a JSON object. null,
  // primitives and arrays are rejected — never coerced.
  if (!isPlainObject(parsed)) return json({ error: 'invalid_body' }, 400);

  if ('installation' in parsed && parsed.installation !== null && !isPlainObject(parsed.installation)) {
    return json({ error: 'invalid_installation' }, 400);
  }
  const checked = validateFacts((parsed.installation ?? {}) as IngestFacts);
  if ('error' in checked) return json({ error: checked.error }, 400);

  if (isBootstrap) {
    if ('events' in parsed) return json({ error: 'invalid_events' }, 400);
    const { data, error } = await rpcs.bootstrap({ ...checked.facts });
    if (error) return json({ error: 'storage_error' }, 500);
    const d = (data ?? {}) as Record<string, unknown>;
    if (d.error === 'registration_throttled') {
      return json({ error: 'registration_throttled' }, 429);
    }
    if (typeof d.error === 'string') return json({ error: 'storage_error' }, 500);
    return json({
      installation_id: d.installation_id,
      installation_secret: d.secret,
      event_id_pool: Array.isArray(d.event_id_pool) ? d.event_id_pool : [],
    });
  }

  // `events` is required and must be an array. A missing or
  // wrong-typed value rejects the request; it is never replaced by
  // an empty array (which would fake a successful heartbeat).
  if (!('events' in parsed) || !Array.isArray(parsed.events)) {
    return json({ error: 'invalid_events' }, 400);
  }
  const events: unknown[] = parsed.events;
  const batchError = checkBatch(events);
  if (batchError) {
    return json({ error: batchError.error, max: MAX_EVENTS, received: batchError.received }, 400);
  }

  // Pool requests are explicit and sized: absent = 0 (a heartbeat
  // grants nothing). A present value must be a non-negative integer;
  // the SQL clamps the actual grant to at most 100.
  let poolRequest = 0;
  if ('pool_request' in parsed) {
    const pr = parsed.pool_request;
    if (typeof pr !== 'number' || !Number.isInteger(pr) || pr < 0 || pr > 1000) {
      return json({ error: 'invalid_pool_request' }, 400);
    }
    poolRequest = pr;
  }

  const { data, error } = await rpcs.ingest({
    p_installation_id: installationId,
    p_secret_hash: await sha256Hex(secret),
    ...checked.facts,
    p_events: events,
    p_pool_request: poolRequest,
  });
  if (error) return json({ error: 'storage_error' }, 500);

  const mapped = mapIngestResult(data);
  return json(mapped.body, mapped.status);
}
