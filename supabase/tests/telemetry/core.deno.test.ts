/**
 * telemetry-ingest handler tests — run with Deno:
 *   deno test --allow-read supabase/tests/telemetry/core.deno.test.ts
 * Exercises the REAL handleIngestRequest from the function's core.ts
 * with a fake RPC standing in for public.telemetry_ingest().
 */
import {
  handleIngestRequest,
  MAX_EVENTS,
} from '../../functions/telemetry-ingest/core.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEquals(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

const ID = '12345678-1234-4234-9234-1234567890ab';
const SECRET = 's'.repeat(40);

interface RpcSpy {
  calls: Record<string, unknown>[];
  result: { data: unknown; error: unknown };
}
function spy(result: RpcSpy['result']): { rpc: (a: Record<string, unknown>) => Promise<RpcSpy['result']>; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    rpc: async (args: Record<string, unknown>) => {
      calls.push(args);
      return result;
    },
  };
}
const OK_VERDICT = { data: { accepted: [], duplicates: [], rejected: [] }, error: null };

function req(body: unknown, headers: Record<string, string> = {}, raw?: string): Request {
  return new Request('https://example.test/functions/v1/telemetry-ingest', {
    method: 'POST',
    headers: {
      'x-installation-id': ID,
      'x-installation-secret': SECRET,
      ...headers,
    },
    body: raw ?? JSON.stringify(body),
  });
}
async function bodyJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

Deno.test('valid request without any Supabase session reaches the RPC with a hashed secret', async () => {
  const { rpc, calls } = spy(OK_VERDICT);
  const res = await handleIngestRequest(
    req({ installation: { platform: 'android', app_version: '1.1.8', version_code: 10 }, events: [] }),
    rpc,
  );
  assertEquals(res.status, 200, 'status');
  assertEquals(calls.length, 1, 'rpc called once');
  const args = calls[0];
  assertEquals(args.p_installation_id, ID, 'installation id passed');
  assert(typeof args.p_secret_hash === 'string' && (args.p_secret_hash as string).length === 64, 'secret hashed to sha-256 hex');
  assert((args.p_secret_hash as string) !== SECRET, 'raw secret never forwarded');
  assert(Array.isArray(args.p_events) && (args.p_events as unknown[]).length === 0, 'empty events = heartbeat');
});

Deno.test('missing or short installation secret is 401 and never reaches the RPC', async () => {
  const { rpc, calls } = spy(OK_VERDICT);
  const noSecret = new Request('https://example.test/', {
    method: 'POST',
    headers: { 'x-installation-id': ID },
    body: JSON.stringify({ events: [] }),
  });
  assertEquals((await handleIngestRequest(noSecret, rpc)).status, 401, 'no secret');
  assertEquals((await handleIngestRequest(req({ events: [] }, { 'x-installation-secret': 'short' }), rpc)).status, 401, 'short secret');
  assertEquals((await handleIngestRequest(req({ events: [] }, { 'x-installation-id': 'not-a-uuid' }), rpc)).status, 401, 'bad id');
  assertEquals(calls.length, 0, 'rpc untouched');
});

Deno.test('wrong installation secret surfaces as 403 from the database verdict', async () => {
  const { rpc } = spy({ data: { error: 'secret_mismatch' }, error: null });
  const res = await handleIngestRequest(req({ events: [] }), rpc);
  assertEquals(res.status, 403, 'status');
  assertEquals((await bodyJson(res)).error, 'secret_mismatch', 'error code');
});

Deno.test('registration throttling maps to 429 so the client keeps its queue', async () => {
  const { rpc } = spy({ data: { error: 'registration_throttled' }, error: null });
  const res = await handleIngestRequest(req({ events: [] }), rpc);
  assertEquals(res.status, 429, 'status');
});

Deno.test('non-object JSON roots are rejected, never coerced', async () => {
  const { rpc, calls } = spy(OK_VERDICT);
  for (const raw of ['null', '42', '"text"', '[1,2,3]', 'true']) {
    const res = await handleIngestRequest(req(null, {}, raw), rpc);
    assertEquals(res.status, 400, `root ${raw}`);
    assertEquals((await bodyJson(res)).error, 'invalid_body', `error for ${raw}`);
  }
  assertEquals(calls.length, 0, 'rpc untouched');
});

Deno.test('missing or non-array events reject the request (no fake empty heartbeat)', async () => {
  const { rpc, calls } = spy(OK_VERDICT);
  for (const body of [{}, { events: 'nope' }, { events: 42 }, { events: null }, { installation: {} }]) {
    const res = await handleIngestRequest(req(body), rpc);
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals((await bodyJson(res)).error, 'invalid_events', 'error code');
  }
  assertEquals(calls.length, 0, 'rpc untouched');
});

Deno.test('a batch over the cap hard-rejects before the RPC', async () => {
  const { rpc, calls } = spy(OK_VERDICT);
  const events = Array.from({ length: MAX_EVENTS + 1 }, () => ({}));
  const res = await handleIngestRequest(req({ events }), rpc);
  assertEquals(res.status, 400, 'status');
  assertEquals((await bodyJson(res)).error, 'batch_too_large', 'error code');
  assertEquals(calls.length, 0, 'rpc untouched');
});

Deno.test('an oversized streamed body is cut at the byte cap (413), RPC untouched', async () => {
  const { rpc, calls } = spy(OK_VERDICT);
  const big = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(16384).fill(97));
    },
  });
  const request = new Request('https://example.test/', {
    method: 'POST',
    headers: { 'x-installation-id': ID, 'x-installation-secret': SECRET },
    body: big,
    // @ts-expect-error: duplex is required by the fetch spec for stream bodies
    duplex: 'half',
  });
  const res = await handleIngestRequest(request, rpc);
  assertEquals(res.status, 413, 'status');
  assertEquals(calls.length, 0, 'rpc untouched');
});

Deno.test('non-object installation facts and bad enums reject the request', async () => {
  const { rpc, calls } = spy(OK_VERDICT);
  const badInstall = await handleIngestRequest(req({ installation: 'x', events: [] }), rpc);
  assertEquals(badInstall.status, 400, 'installation shape');
  assertEquals((await bodyJson(badInstall)).error, 'invalid_installation', 'code');
  const badPlatform = await handleIngestRequest(req({ installation: { platform: 'windows' }, events: [] }), rpc);
  assertEquals(badPlatform.status, 400, 'platform enum');
  assertEquals(calls.length, 0, 'rpc untouched');
});

Deno.test('RPC failure maps to 500 (client keeps its queue)', async () => {
  const { rpc } = spy({ data: null, error: new Error('db down') });
  const res = await handleIngestRequest(req({ events: [] }), rpc);
  assertEquals(res.status, 500, 'status');
});

Deno.test('GET is refused', async () => {
  const { rpc } = spy(OK_VERDICT);
  const res = await handleIngestRequest(new Request('https://example.test/', { method: 'GET' }), rpc);
  assertEquals(res.status, 405, 'status');
});
