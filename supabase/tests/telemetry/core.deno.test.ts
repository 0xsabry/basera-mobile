/**
 * telemetry-ingest handler tests — run with Deno:
 *   deno test --allow-read supabase/tests/telemetry/core.deno.test.ts
 * Exercises the REAL handleIngestRequest from the function's core.ts
 * with fake RPCs standing in for telemetry_ingest / telemetry_bootstrap.
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

interface RpcResult {
  data: unknown;
  error: unknown;
}
function spies(ingestResult: RpcResult, bootstrapResult?: RpcResult) {
  const ingestCalls: Record<string, unknown>[] = [];
  const bootstrapCalls: Record<string, unknown>[] = [];
  return {
    ingestCalls,
    bootstrapCalls,
    rpcs: {
      ingest: async (args: Record<string, unknown>) => {
        ingestCalls.push(args);
        return ingestResult;
      },
      bootstrap: async (args: Record<string, unknown>) => {
        bootstrapCalls.push(args);
        return bootstrapResult ?? { data: null, error: new Error('unused') };
      },
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
  const { rpcs, ingestCalls } = spies(OK_VERDICT);
  const res = await handleIngestRequest(
    req({ installation: { platform: 'android', app_version: '1.1.8', version_code: 10 }, events: [] }),
    rpcs,
  );
  assertEquals(res.status, 200, 'status');
  assertEquals(ingestCalls.length, 1, 'rpc called once');
  const args = ingestCalls[0];
  assertEquals(args.p_installation_id, ID, 'installation id passed');
  assert(typeof args.p_secret_hash === 'string' && (args.p_secret_hash as string).length === 64, 'secret hashed to sha-256 hex');
  assert((args.p_secret_hash as string) !== SECRET, 'raw secret never forwarded');
  assert(Array.isArray(args.p_events) && (args.p_events as unknown[]).length === 0, 'empty events = heartbeat');
});

Deno.test('missing or short installation secret is 401 and never reaches the RPC', async () => {
  const { rpcs, ingestCalls } = spies(OK_VERDICT);
  const noSecret = new Request('https://example.test/', {
    method: 'POST',
    headers: { 'x-installation-id': ID },
    body: JSON.stringify({ events: [] }),
  });
  assertEquals((await handleIngestRequest(noSecret, rpcs)).status, 401, 'no secret');
  assertEquals((await handleIngestRequest(req({ events: [] }, { 'x-installation-secret': 'short' }), rpcs)).status, 401, 'short secret');
  assertEquals((await handleIngestRequest(req({ events: [] }, { 'x-installation-id': 'not-a-uuid' }), rpcs)).status, 401, 'bad id');
  assertEquals(ingestCalls.length, 0, 'rpc untouched');
});

Deno.test('wrong secret and unknown installation surface as 403 from the verdict', async () => {
  for (const err of ['secret_mismatch', 'unknown_installation']) {
    const { rpcs } = spies({ data: { error: err }, error: null });
    const res = await handleIngestRequest(req({ events: [] }), rpcs);
    assertEquals(res.status, 403, `${err} status`);
    assertEquals((await bodyJson(res)).error, err, 'error code');
  }
});

Deno.test('registration throttling maps to 429 so the client keeps its queue', async () => {
  const { rpcs } = spies({ data: { error: 'registration_throttled' }, error: null });
  const res = await handleIngestRequest(req({ events: [] }), rpcs);
  assertEquals(res.status, 429, 'status');
});

Deno.test('non-object JSON roots are rejected, never coerced', async () => {
  const { rpcs, ingestCalls } = spies(OK_VERDICT);
  for (const raw of ['null', '42', '"text"', '[1,2,3]', 'true']) {
    const res = await handleIngestRequest(req(null, {}, raw), rpcs);
    assertEquals(res.status, 400, `root ${raw}`);
    assertEquals((await bodyJson(res)).error, 'invalid_body', `error for ${raw}`);
  }
  assertEquals(ingestCalls.length, 0, 'rpc untouched');
});

Deno.test('missing or non-array events reject the request (no fake empty heartbeat)', async () => {
  const { rpcs, ingestCalls } = spies(OK_VERDICT);
  for (const body of [{}, { events: 'nope' }, { events: 42 }, { events: null }, { installation: {} }]) {
    const res = await handleIngestRequest(req(body), rpcs);
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals((await bodyJson(res)).error, 'invalid_events', 'error code');
  }
  assertEquals(ingestCalls.length, 0, 'rpc untouched');
});

Deno.test('a batch over the cap hard-rejects before the RPC', async () => {
  const { rpcs, ingestCalls } = spies(OK_VERDICT);
  const events = Array.from({ length: MAX_EVENTS + 1 }, () => ({}));
  const res = await handleIngestRequest(req({ events }), rpcs);
  assertEquals(res.status, 400, 'status');
  assertEquals((await bodyJson(res)).error, 'batch_too_large', 'error code');
  assertEquals(ingestCalls.length, 0, 'rpc untouched');
});

Deno.test('an oversized streamed body is cut at the byte cap (413), RPC untouched', async () => {
  const { rpcs, ingestCalls } = spies(OK_VERDICT);
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
  const res = await handleIngestRequest(request, rpcs);
  assertEquals(res.status, 413, 'status');
  assertEquals(ingestCalls.length, 0, 'rpc untouched');
});

Deno.test('non-object installation facts and bad enums reject the request', async () => {
  const { rpcs, ingestCalls } = spies(OK_VERDICT);
  const badInstall = await handleIngestRequest(req({ installation: 'x', events: [] }), rpcs);
  assertEquals(badInstall.status, 400, 'installation shape');
  assertEquals((await bodyJson(badInstall)).error, 'invalid_installation', 'code');
  const badPlatform = await handleIngestRequest(req({ installation: { platform: 'windows' }, events: [] }), rpcs);
  assertEquals(badPlatform.status, 400, 'platform enum');
  assertEquals(ingestCalls.length, 0, 'rpc untouched');
});

Deno.test('is_embedded_launch is tri-state: non-boolean rejected, absent stays null', async () => {
  const { rpcs, ingestCalls } = spies(OK_VERDICT);
  const bad = await handleIngestRequest(
    req({ installation: { is_embedded_launch: 'yes' }, events: [] }),
    rpcs,
  );
  assertEquals(bad.status, 400, 'string value rejected');
  assertEquals((await bodyJson(bad)).error, 'invalid_is_embedded_launch', 'code');
  assertEquals(ingestCalls.length, 0, 'rpc untouched for the bad request');

  const absent = await handleIngestRequest(req({ installation: {}, events: [] }), rpcs);
  assertEquals(absent.status, 200, 'absent is allowed');
  assertEquals(ingestCalls[0].p_is_embedded_launch, null, 'absent stays unknown (null), never false');

  const explicitFalse = await handleIngestRequest(
    req({ installation: { is_embedded_launch: false }, events: [] }),
    rpcs,
  );
  assertEquals(explicitFalse.status, 200, 'false is a real value');
  assertEquals(ingestCalls[1].p_is_embedded_launch, false, 'false passes through as false');
});

Deno.test('bootstrap mode issues an identity without any secret headers', async () => {
  const issued = {
    data: {
      installation_id: ID,
      secret: 'ab'.repeat(32),
      event_id_pool: ['11111111-2222-4333-8444-555555555555'],
    },
    error: null,
  };
  const { rpcs, bootstrapCalls, ingestCalls } = spies(OK_VERDICT, issued);
  const request = new Request('https://example.test/', {
    method: 'POST',
    headers: { 'x-telemetry-bootstrap': '1' },
    body: JSON.stringify({ installation: { platform: 'android', app_version: '1.1.8' } }),
  });
  const res = await handleIngestRequest(request, rpcs);
  assertEquals(res.status, 200, 'status');
  const body = await bodyJson(res);
  assertEquals(body.installation_id, ID, 'id returned');
  assertEquals(body.installation_secret, 'ab'.repeat(32), 'secret returned once');
  assert(Array.isArray(body.event_id_pool) && body.event_id_pool.length === 1, 'pool returned');
  assertEquals(bootstrapCalls.length, 1, 'bootstrap rpc called');
  assertEquals(ingestCalls.length, 0, 'ingest rpc untouched');
});

Deno.test('bootstrap rejects events payloads and maps throttling to 429', async () => {
  const { rpcs, bootstrapCalls } = spies(OK_VERDICT, { data: { error: 'registration_throttled' }, error: null });
  const withEvents = new Request('https://example.test/', {
    method: 'POST',
    headers: { 'x-telemetry-bootstrap': '1' },
    body: JSON.stringify({ events: [] }),
  });
  const bad = await handleIngestRequest(withEvents, rpcs);
  assertEquals(bad.status, 400, 'events in bootstrap = protocol error');
  assertEquals(bootstrapCalls.length, 0, 'rpc untouched');

  const plain = new Request('https://example.test/', {
    method: 'POST',
    headers: { 'x-telemetry-bootstrap': '1' },
    body: JSON.stringify({ installation: {} }),
  });
  const throttled = await handleIngestRequest(plain, rpcs);
  assertEquals(throttled.status, 429, 'throttled maps to 429');
});

Deno.test('RPC failure maps to 500 (client keeps its queue)', async () => {
  const { rpcs } = spies({ data: null, error: new Error('db down') });
  const res = await handleIngestRequest(req({ events: [] }), rpcs);
  assertEquals(res.status, 500, 'status');
});

Deno.test('GET is refused', async () => {
  const { rpcs } = spies(OK_VERDICT);
  const res = await handleIngestRequest(new Request('https://example.test/', { method: 'GET' }), rpcs);
  assertEquals(res.status, 405, 'status');
});

Deno.test('the verdict passes the event-id pool top-up through to the client', async () => {
  const pool = ['11111111-2222-4333-8444-555555555555', '22222222-3333-4444-8555-666666666666'];
  const { rpcs } = spies({ data: { accepted: [], duplicates: [], rejected: [], event_id_pool: pool }, error: null });
  const res = await handleIngestRequest(req({ events: [] }), rpcs);
  assertEquals(res.status, 200, 'status');
  const body = await bodyJson(res);
  assert(Array.isArray(body.event_id_pool) && (body.event_id_pool as string[]).length === 2, 'pool passed through');
  assertEquals((body.event_id_pool as string[])[0], pool[0], 'pool contents intact');
});

Deno.test('pool_request: sized values pass through, malformed values are refused pre-RPC', async () => {
  const sized = spies(OK_VERDICT);
  const okRes = await handleIngestRequest(req({ installation: { platform: 'android' }, events: [], pool_request: 30 }), sized.rpcs);
  assertEquals(okRes.status, 200, 'sized request accepted');
  assertEquals(sized.ingestCalls[0].p_pool_request, 30, 'request forwarded to the RPC');

  for (const bad of [1.5, -1, 'x', 1001]) {
    const s = spies(OK_VERDICT);
    const res = await handleIngestRequest(req({ installation: { platform: 'android' }, events: [], pool_request: bad }), s.rpcs);
    assertEquals(res.status, 400, `pool_request ${JSON.stringify(bad)} refused`);
    assertEquals(((await res.json()) as { error?: string }).error, 'invalid_pool_request', 'error code');
    assertEquals(s.ingestCalls.length, 0, 'RPC untouched on a malformed pool request');
  }

  const absent = spies(OK_VERDICT);
  const absentRes = await handleIngestRequest(req({ installation: { platform: 'android' }, events: [] }), absent.rpcs);
  assertEquals(absentRes.status, 200, 'absent pool_request accepted');
  assertEquals(absent.ingestCalls[0].p_pool_request, 0, 'absent means ask for nothing');
});
