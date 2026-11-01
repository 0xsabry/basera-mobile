/**
 * telemetry-ingest core — pure, runtime-agnostic helpers (no imports).
 * Kept separate from index.ts so the mandatory behavior tests can run
 * under Node's type stripping without the Deno/supabase-js wiring.
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
  return {
    facts: {
      p_platform: str(facts.platform, 16),
      p_os_version: str(facts.os_version, 32),
      p_app_version: str(facts.app_version, 32),
      p_version_code: typeof vc === 'number' ? vc : null,
      p_runtime_version: str(facts.runtime_version, 32),
      p_channel: str(facts.channel, 32),
      p_current_update_id: typeof cuid === 'string' ? cuid : null,
      p_is_embedded_launch: facts.is_embedded_launch === true,
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
  if (r.error === 'secret_mismatch' || r.error === 'invalid_installation_credentials') {
    return { status: 403, body: { error: r.error } };
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
    },
  };
}
