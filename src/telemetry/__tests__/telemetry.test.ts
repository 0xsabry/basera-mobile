/**
 * Telemetry client tests — v6 (atomic envelope + SecureStore-only
 * identity + tri-state facts).
 *
 * The harness simulates the server honestly: bootstrap issues
 * DISTINCT identities/secrets/id pools per call (as the server's
 * CSPRNG would), and the post mock applies verdicts like the real
 * ingest function. The queue store (envelope) and the SecureStore
 * (identity) are independent and can be slowed/failed separately.
 */
import {
  Telemetry,
  type BootstrapResult,
  type FlushVerdict,
  type InstallationFacts,
  type QueuedEvent,
} from '../telemetry';

class MemoryStore {
  data = new Map<string, string>();
  failSets = 0;
  gate: Promise<void> | null = null;
  throwOnGet = false;
  async get(key: string): Promise<string | null> {
    if (this.throwOnGet) throw new Error('store unavailable');
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    if (this.gate) await this.gate;
    if (this.failSets > 0) {
      this.failSets--;
      throw new Error('write failed');
    }
    this.data.set(key, value);
  }
}

interface PostedBatch {
  installation: InstallationFacts;
  events: QueuedEvent[];
  pool_request?: number;
}

const ENVELOPE_KEY = 'basera.telemetry.envelope.v1';
const IDENTITY_KEY = 'basera.install.identity.v1';
const U1 = '11111111-2222-4333-8444-555555555555';

function makeFacts(over: Partial<InstallationFacts> = {}): InstallationFacts {
  return {
    platform: 'android',
    os_version: '34',
    app_version: '1.1.8',
    version_code: 10,
    runtime_version: '1.1.0',
    channel: 'preview',
    current_update_id: null,
    is_embedded_launch: true,
    ...over,
  };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A fake server: every bootstrap issues a fresh identity + pool. */
class FakeServer {
  private seq = 0;
  bootstrapCalls = 0;
  issue(): BootstrapResult {
    this.bootstrapCalls++;
    const n = ++this.seq;
    return {
      installation_id: uuid(100000 + n),
      installation_secret: `server-secret-${n}-${'x'.repeat(40)}`,
      event_id_pool: Array.from({ length: 100 }, (_, i) => uuid(n * 10000 + i)), // the real bootstrap grant is 100
    };
  }
}

function makeTelemetry(opts: {
  queueStore: MemoryStore;
  secureStore?: MemoryStore;
  facts?: InstallationFacts;
  online: boolean;
  bootstrapOnline?: boolean;
  posted: PostedBatch[];
  server: FakeServer;
  verdictFor?: (events: QueuedEvent[], body: PostedBatch) => FlushVerdict | null;
  headersSeen?: Record<string, string>[];
  grants?: number[];
}) {
  return new Telemetry({
    queueStore: opts.queueStore,
    secureStore: opts.secureStore ?? opts.queueStore,
    endpoint: 'https://example.test/functions/v1/telemetry-ingest',
    publishableKey: 'sb_publishable_test',
    facts: () => opts.facts ?? makeFacts(),
    now: () => new Date('2026-11-01T12:00:00.000Z'),
    requestBootstrap: async () => {
      if (!(opts.bootstrapOnline ?? opts.online)) return null;
      return opts.server.issue();
    },
    post: async (_url, headers, body) => {
      if (!opts.online) return null;
      opts.headersSeen?.push(headers);
      const batch = body as PostedBatch;
      opts.posted.push(batch);
      if (opts.verdictFor) return opts.verdictFor(batch.events, batch);
      // The honest server: grants ids ONLY against a sized request,
      // clamped to 100 — exactly like the SQL.
      const grant = Math.min(Math.max(batch.pool_request ?? 0, 0), 100);
      opts.grants?.push(grant);
      return {
        accepted: batch.events.map((e) => e.client_event_id as string),
        duplicates: [],
        rejected: [],
        event_id_pool: Array.from({ length: grant }, (_, i) => uuid(900000 + i)),
      };
    },
  });
}

const envelopeOf = (store: MemoryStore) =>
  JSON.parse(store.data.get(ENVELOPE_KEY) as string) as {
    queue: QueuedEvent[];
    pool: string[];
    deadLetter: { reason: string }[];
  };

describe('server-issued identity (single SecureStore value)', () => {
  it('bootstraps once, persists id+secret as ONE value, and reuses it on the next launch', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const t1 = makeTelemetry({ queueStore: store, online: true, posted: [], server });
    await t1.init();
    expect(server.bootstrapCalls).toBe(1);
    const stored = JSON.parse(store.data.get(IDENTITY_KEY) as string) as { id: string; secret: string };
    expect(stored.id).toBe(uuid(100001));
    expect(stored.secret).toContain('server-secret-1-');
    // The secret must exist ONLY in the identity value — never in the envelope.
    expect(store.data.get(ENVELOPE_KEY)).not.toContain('server-secret');

    const t2 = makeTelemetry({ queueStore: store, online: true, posted: [], server });
    await t2.init();
    expect(server.bootstrapCalls).toBe(1); // restored locally, not re-issued
    expect(t2.issuedIdentity?.id).toBe(stored.id);
  });

  it('an identity whose save fails is NOT adopted; the retry restores-or-reissues honestly', async () => {
    const queueStore = new MemoryStore();
    const secureStore = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    secureStore.failSets = 1; // the identity save will fail
    const t = makeTelemetry({ queueStore, secureStore, online: true, posted, server });
    expect(await t.flush()).toBe(false);
    expect(t.issuedIdentity).toBeNull();
    expect(server.bootstrapCalls).toBe(1);
    expect(posted).toHaveLength(0);
    // Next flush: re-reads storage first (still absent), then re-issues.
    expect(await t.flush()).toBe(true);
    expect(server.bootstrapCalls).toBe(2);
    expect(t.issuedIdentity?.id).toBe(uuid(100002)); // the second, persisted identity
    const stored = JSON.parse(secureStore.data.get(IDENTITY_KEY) as string) as { id: string };
    expect(stored.id).toBe(uuid(100002));
  });

  it('a pre-stored identity is restored with zero bootstrap calls', async () => {
    const queueStore = new MemoryStore();
    const secureStore = new MemoryStore();
    secureStore.data.set(IDENTITY_KEY, JSON.stringify({ id: uuid(424242), secret: 'restored-secret-0123456789abcdef' }));
    const server = new FakeServer();
    const t = makeTelemetry({ queueStore, secureStore, online: true, posted: [], server });
    await t.init();
    expect(server.bootstrapCalls).toBe(0);
    expect(t.issuedIdentity?.id).toBe(uuid(424242));
  });
});

describe('secure-store outage', () => {
  it('events keep queueing while SecureStore is down; nothing is sent and no bootstrap is attempted; sending resumes on recovery', async () => {
    const queueStore = new MemoryStore();
    const secureStore = new MemoryStore();
    secureStore.throwOnGet = true;
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({ queueStore, secureStore, online: true, posted, server });
    await t.record({ type: 'update_check' });
    await t.record({ type: 'update_available', updateId: U1 });
    expect(t.queuedCount).toBe(2);
    expect(envelopeOf(queueStore).queue).toHaveLength(2); // durable in the envelope
    expect(await t.flush()).toBe(false);
    expect(posted).toHaveLength(0);
    expect(server.bootstrapCalls).toBe(0); // never asked: its result could not be stored

    secureStore.throwOnGet = false; // SecureStore recovers
    expect(await t.flush()).toBe(true);
    expect(server.bootstrapCalls).toBe(1);
    expect(posted.flatMap((b) => b.events)).toHaveLength(2);
    expect(t.queuedCount).toBe(0);
  });
});

describe('event id pool durability', () => {
  it('consumed pool ids are never reused after a restart', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const t1 = makeTelemetry({ queueStore: store, online: true, posted: [], server });
    await t1.init(); // bootstrap seeds the pool (persisted in the envelope)
    await t1.record({ type: 'update_check' });
    await t1.record({ type: 'update_check' });
    await t1.record({ type: 'update_check' });
    const firstIds = envelopeOf(store).queue.map((e) => e.client_event_id);
    expect(firstIds.every((i) => typeof i === 'string')).toBe(true);

    const t2 = makeTelemetry({ queueStore: store, online: true, posted: [], server });
    await t2.record({ type: 'update_check' });
    await t2.record({ type: 'update_check' });
    // t2 shares the same underlying store object; its in-memory state
    // was loaded from the persisted envelope, so read via a third view:
    const t3 = makeTelemetry({ queueStore: store, online: false, posted: [], server });
    await t3.record({ type: 'update_check' });
    const all = envelopeOf(store).queue.map((e) => e.client_event_id);
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6); // zero reuse across restarts
    for (const id of firstIds) expect(all.filter((x) => x === id)).toHaveLength(1);
  });

  it('never touches Math.random for identity, secrets, or event ids', async () => {
    const spy = jest.spyOn(Math, 'random');
    const store = new MemoryStore();
    const server = new FakeServer();
    const t = makeTelemetry({ queueStore: store, online: true, posted: [], server });
    await t.init();
    await t.record({ type: 'update_check' });
    await t.flush();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('update lifecycle + tri-state facts', () => {
  it('applied is recorded once when the launched update matches the download', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t1 = makeTelemetry({ queueStore: store, online: true, posted, server });
    await t1.init();
    await t1.handleUpdateEvent({ type: 'update_check' });
    await t1.handleUpdateEvent({ type: 'update_available', updateId: U1 });
    await t1.handleUpdateEvent({ type: 'update_downloaded', updateId: U1 });
    await t1.flush();
    const first = posted.flatMap((b) => b.events).map((e) => e.event_type);
    expect(first).toContain('update_downloaded');
    expect(first).not.toContain('update_applied');

    const t2 = makeTelemetry({
      queueStore: store, online: true, posted, server,
      facts: makeFacts({ current_update_id: U1, is_embedded_launch: false }),
    });
    await t2.init();
    const applied = posted.flatMap((b) => b.events).filter((e) => e.event_type === 'update_applied');
    expect(applied).toHaveLength(1);
    expect(applied[0].update_id).toBe(U1);
  });

  it('an unknown (null) embedded state is sent as null, never fabricated, and preserves the staged download', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t1 = makeTelemetry({ queueStore: store, online: true, posted, server });
    await t1.init();
    await t1.handleUpdateEvent({ type: 'update_downloaded', updateId: U1 });
    await t1.flush();

    // A launch where expo-updates could not be read: embedded unknown.
    const t2 = makeTelemetry({
      queueStore: store, online: true, posted, server,
      facts: makeFacts({ current_update_id: null, is_embedded_launch: null }),
    });
    await t2.init();
    const heartbeats = posted.filter((b) => b.installation.is_embedded_launch === null);
    expect(heartbeats.length).toBeGreaterThan(0); // null went over the wire as null
    expect(posted.flatMap((b) => b.events).filter((e) => e.event_type === 'update_applied')).toHaveLength(0);

    // The staged download survived the unknown launch: the real
    // launch onto U1 still produces exactly one applied event.
    const t3 = makeTelemetry({
      queueStore: store, online: true, posted, server,
      facts: makeFacts({ current_update_id: U1, is_embedded_launch: false }),
    });
    await t3.init();
    const applied = posted.flatMap((b) => b.events).filter((e) => e.event_type === 'update_applied');
    expect(applied).toHaveLength(1);
  });

  it('queues events while fully offline and delivers them after bootstrap, losing nothing', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const offline = makeTelemetry({ queueStore: store, online: false, posted, server });
    await offline.record({ type: 'update_check' });
    await offline.record({ type: 'update_failed', failureReason: 'network unreachable' });
    expect(await offline.flush()).toBe(false);
    expect(envelopeOf(store).queue).toHaveLength(2);
    expect(server.bootstrapCalls).toBe(0);

    const online = makeTelemetry({ queueStore: store, online: true, posted, server });
    await online.init();
    const delivered = posted.flatMap((b) => b.events);
    expect(delivered.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['update_check', 'update_failed']),
    );
    const ids = delivered.map((e) => e.client_event_id);
    expect(ids.every((i) => typeof i === 'string' && i.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(online.queuedCount).toBe(0);
  });
});

describe('server verdicts', () => {
  const setup = (verdictFor: (events: QueuedEvent[]) => FlushVerdict | null) => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({ queueStore: store, online: true, posted, server, verdictFor });
    return { store, server, posted, t };
  };

  it('a definitively rejected event dead-letters inside the envelope, kept locally', async () => {
    const { store, t } = setup((events) => ({
      accepted: [],
      duplicates: [],
      rejected: events.map((e) => ({ client_event_id: e.client_event_id, reason: 'invalid_update_id' })),
    }));
    await t.init();
    await t.handleUpdateEvent({ type: 'update_available', updateId: 'not-a-uuid' });
    await t.flush();
    expect(t.queuedCount).toBe(0);
    expect(t.deadLetterCount).toBe(1);
    expect(envelopeOf(store).deadLetter[0].reason).toBe('invalid_update_id');
  });

  it('rate_limited keeps the event queued; duplicates are removed like accepted', async () => {
    const a = setup((events) => ({
      accepted: [],
      duplicates: [],
      rejected: events.map((e) => ({ client_event_id: e.client_event_id, reason: 'rate_limited' })),
    }));
    await a.t.init();
    await a.t.handleUpdateEvent({ type: 'update_check' });
    await a.t.flush();
    expect(a.t.queuedCount).toBe(1);
    expect(a.t.deadLetterCount).toBe(0);

    const b = setup((events) => ({
      accepted: [],
      duplicates: events.map((e) => e.client_event_id as string),
      rejected: [],
    }));
    await b.t.init();
    await b.t.handleUpdateEvent({ type: 'update_check' });
    await b.t.flush();
    expect(b.t.queuedCount).toBe(0);
    expect(b.t.deadLetterCount).toBe(0);
  });
});

describe('overflow policy', () => {
  it('refuses low-value events at capacity and counts them — queued events are never dropped', async () => {
    const store = new MemoryStore();
    const t = makeTelemetry({ queueStore: store, online: false, posted: [], server: new FakeServer() });
    for (let i = 0; i < 210; i++) await t.record({ type: 'update_check' });
    expect(t.queuedCount).toBe(200);
    expect(t.overflowStats.refused.update_check).toBe(10);
    expect(envelopeOf(store).queue).toHaveLength(200);
  });

  it('a critical event evicts the oldest low-value event (counted)', async () => {
    const store = new MemoryStore();
    const t = makeTelemetry({ queueStore: store, online: false, posted: [], server: new FakeServer() });
    for (let i = 0; i < 200; i++) await t.record({ type: 'update_check' });
    await t.record({ type: 'update_applied', updateId: U1 });
    expect(t.queuedCount).toBe(200);
    expect(t.overflowStats.evicted.update_check).toBe(1);
    const q = envelopeOf(store).queue;
    expect(q.some((e) => e.event_type === 'update_applied')).toBe(true);
    expect(q.filter((e) => e.event_type === 'update_check')).toHaveLength(199);
  });

  it('dead-letter rotation is capped and counted, not silent', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const t = makeTelemetry({
      queueStore: store, online: true, posted: [], server,
      verdictFor: (events, body) => ({
        accepted: [],
        duplicates: [],
        rejected: events.map((e) => ({ client_event_id: e.client_event_id, reason: 'invalid_event_type' })),
        // a realistic server still honors sized pool requests
        event_id_pool: Array.from({ length: Math.min(body.pool_request ?? 0, 100) }, (_, i) => uuid(800000 + i)),
      }),
    });
    await t.init();
    for (let i = 0; i < 105; i++) await t.record({ type: 'update_failed', failureReason: 'x' });
    await t.flush();
    await t.flush();
    await t.flush();
    expect(t.deadLetterCount).toBe(100);
    expect(t.deadLetterDropped).toBe(5);
  });
});

describe('atomic envelope + crash recovery', () => {
  it('record() resolves only after the envelope write lands', async () => {
    const store = new MemoryStore();
    let release!: () => void;
    store.gate = new Promise<void>((r) => (release = r));
    const t = makeTelemetry({ queueStore: store, online: true, posted: [], server: new FakeServer() });
    let resolved = false;
    const p = t.record({ type: 'update_check' }).then((ok) => {
      resolved = true;
      return ok;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);
    release();
    await expect(p).resolves.toBe(true);
    expect(envelopeOf(store).queue).toHaveLength(1);
  });

  it('flush refuses to send when the envelope cannot be persisted first', async () => {
    const store = new MemoryStore();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({ queueStore: store, online: true, posted, server: new FakeServer() });
    await t.record({ type: 'update_check' });
    store.failSets = 1000;
    expect(await t.flush()).toBe(false);
    expect(posted).toHaveLength(0);
  });

  it('a failed enqueue write loses the event cleanly — no half-state after restart', async () => {
    const store = new MemoryStore();
    const t = makeTelemetry({ queueStore: store, online: true, posted: [], server: new FakeServer() });
    await t.record({ type: 'update_check' });
    store.failSets = 1;
    await expect(t.record({ type: 'update_available', updateId: U1 })).resolves.toBe(false);
    const after = makeTelemetry({ queueStore: store, online: false, posted: [], server: new FakeServer() });
    await after.record({ type: 'update_check' }); // forces a load+append on the persisted envelope
    const q = envelopeOf(store).queue;
    expect(q.map((e) => e.event_type)).toEqual(['update_check', 'update_check']); // the failed one is simply absent
  });

  it('a crash before the post-verdict persist resends the same events (server dedupes)', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    let crashArmed = false;
    const t1 = makeTelemetry({
      queueStore: store, online: true, posted, server,
      verdictFor: (events) => {
        if (events.length > 0) crashArmed = true;
        return { accepted: events.map((e) => e.client_event_id as string), duplicates: [], rejected: [] };
      },
    });
    await t1.init();
    await t1.record({ type: 'update_check' });
    const realSet = store.set.bind(store);
    store.set = async (k: string, v: string) => {
      if (crashArmed && k === ENVELOPE_KEY) {
        crashArmed = false;
        throw new Error('crash during persist');
      }
      return realSet(k, v);
    };
    expect(await t1.flush()).toBe(false);
    const sentFirst = posted.flatMap((b) => b.events).map((e) => e.client_event_id);
    expect(sentFirst).toHaveLength(1);

    store.set = realSet;
    const t2 = makeTelemetry({ queueStore: store, online: true, posted, server });
    await t2.init();
    const resent = posted.flatMap((b) => b.events).map((e) => e.client_event_id);
    expect(resent.filter((id) => id === sentFirst[0])).toHaveLength(2); // same id resent
    expect(t2.queuedCount).toBe(0);
  });

  it('a corrupt envelope is quarantined, never silently trusted', async () => {
    const store = new MemoryStore();
    store.data.set(ENVELOPE_KEY, '{"version":1,"queue":"not-an-array"');
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({ queueStore: store, online: true, posted, server });
    await t.init();
    expect(store.data.get('basera.telemetry.envelope.corrupt')).toContain('not-an-array');
    expect(t.queuedCount).toBe(0);
    expect(posted.length).toBeGreaterThan(0); // telemetry still functions
  });

  it('FAILS CLOSED when the envelope cannot be read: no bootstrap, no ingest, no writes — and recovery loses nothing', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const healthy = makeTelemetry({ queueStore: store, online: true, posted, server });
    await healthy.init();
    await healthy.record({ type: 'update_check' });
    const rawBefore = store.data.get(ENVELOPE_KEY);

    store.throwOnGet = true;
    const blocked = makeTelemetry({ queueStore: store, online: true, posted, server });
    await expect(blocked.record({ type: 'update_available', updateId: U1 })).resolves.toBe(false);
    expect(await blocked.flush()).toBe(false);
    expect(server.bootstrapCalls).toBe(1); // only the healthy instance's
    expect(store.data.get(ENVELOPE_KEY)).toBe(rawBefore); // untouched bytes

    store.throwOnGet = false; // storage recovers
    const recovered = makeTelemetry({ queueStore: store, online: true, posted, server });
    await recovered.record({ type: 'update_check' });
    const q = envelopeOf(store).queue;
    expect(q.map((e) => e.event_type)).toEqual(['update_check', 'update_check']); // old + new, nothing lost
  });

  it('a corrupt envelope whose quarantine write fails blocks everything instead of overwriting the original', async () => {
    const store = new MemoryStore();
    const CORRUPT = '{"version":1,"queue":"not-an-array"';
    store.data.set(ENVELOPE_KEY, CORRUPT);
    const server = new FakeServer();
    const t = makeTelemetry({ queueStore: store, online: true, posted: [], server });
    store.failSets = 1; // the quarantine write will fail
    await expect(t.record({ type: 'update_check' })).resolves.toBe(false);
    expect(store.data.get(ENVELOPE_KEY)).toBe(CORRUPT); // original preserved
    expect(server.bootstrapCalls).toBe(0);
    // Quarantine succeeds on retry: fresh start, evidence preserved.
    await expect(t.record({ type: 'update_check' })).resolves.toBe(true);
    expect(store.data.get('basera.telemetry.envelope.corrupt')).toBe(CORRUPT);
    expect(envelopeOf(store).queue).toHaveLength(1);
  });
});

describe('pool economics', () => {
  it('100 heartbeats with almost no events grant ZERO extra ids and the pool never grows', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({ queueStore: store, online: true, posted, server });
    await t.init(); // bootstrap seeds exactly 100
    expect(t.poolSize).toBe(100);
    for (let i = 0; i < 100; i++) {
      if (i % 10 === 0) await t.record({ type: 'update_check' }); // 10 events total
      await t.flush();
      expect(t.poolSize).toBeLessThanOrEqual(100);
    }
    // 10 consumed, none granted by verdicts: pool is exactly 90.
    expect(t.poolSize).toBe(90);
    const verdictGrants = posted
      .filter((b) => (b.pool_request ?? 0) > 0)
      .length;
    expect(verdictGrants).toBe(0); // the client never even asked
  });

  it('a drained pool refills with ONE sized request back to the target, never above it', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({ queueStore: store, online: true, posted, server });
    await t.init();
    for (let i = 0; i < 85; i++) await t.record({ type: 'update_check' });
    expect(t.poolSize).toBe(15);
    await t.flush(); // batch of 50 sent; request = 85 -> grant 85
    expect(t.poolSize).toBe(100);
    expect(t.poolDropped).toBe(0);
    const requests = posted.map((b) => b.pool_request ?? 0).filter((n) => n > 0);
    expect(requests).toEqual([85]);
  });

  it('ONE request per flush: 200 events, half id-less — the top-up spends it, the batch carries zero', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const grants: number[] = [];
    const t = makeTelemetry({ queueStore: store, online: true, posted, server, grants });
    await t.init(); // bootstrap: pool 100
    expect(t.poolSize).toBe(100);
    for (let i = 0; i < 200; i++) await t.record({ type: 'update_check' });
    // Accounting BEFORE the flush: 100 ids consumed at enqueue,
    // 100 events still id-less, pool empty.
    expect(t.poolSize).toBe(0);
    expect(t.queuedCount).toBe(200);
    expect(envelopeOf(store).queue.filter((e) => !e.client_event_id)).toHaveLength(100);

    posted.length = 0;
    grants.length = 0;
    await t.flush();

    // Exactly two posts: the top-up (request 100) and the batch
    // (request 0). Total granted across the WHOLE flush: 100, once.
    expect(posted).toHaveLength(2);
    expect(posted[0].events).toHaveLength(0);
    expect(posted[0].pool_request).toBe(100);
    expect(posted[1].events).toHaveLength(50);
    expect(posted[1].pool_request).toBe(0);
    expect(grants.reduce((a, b) => a + b, 0)).toBe(100);
    // Accounting AFTER: granted 100, consumed 100 (the id-less half),
    // remaining pool 0; 200 unique ids exist across sent + queued.
    expect(t.poolSize).toBe(0);
    const remaining = envelopeOf(store).queue;
    expect(remaining).toHaveLength(150);
    const allIds = [
      ...posted[1].events.map((e) => e.client_event_id),
      ...remaining.map((e) => e.client_event_id),
    ];
    expect(allIds.every((i) => typeof i === 'string')).toBe(true);
    expect(new Set(allIds).size).toBe(200);
  });

  it('a failed top-up is never assumed: id-less events stay queued, id-carrying events still send, nothing is lost', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({
      queueStore: store, online: true, posted, server,
      verdictFor: (events) =>
        events.length === 0
          ? null // every heartbeat/top-up fails at transport level
          : { accepted: events.map((e) => e.client_event_id as string), duplicates: [], rejected: [] },
    });
    await t.init(); // identity + pool seeded (bootstrap is a separate channel)
    for (let i = 0; i < 150; i++) await t.record({ type: 'update_check' });
    expect(t.poolSize).toBe(0);
    expect(await t.flush()).toBe(true); // the batch itself succeeded
    expect(t.queuedCount).toBe(100); // 50 sent; 50 id-carrying + 50 id-less remain
    const q = envelopeOf(store).queue;
    expect(q.filter((e) => !e.client_event_id)).toHaveLength(50); // still waiting, not dropped
    expect(q.filter((e) => e.client_event_id)).toHaveLength(50);
    const sentIds = posted.flatMap((b) => b.events).map((e) => e.client_event_id);
    expect(new Set([...sentIds, ...q.map((e) => e.client_event_id)]).size).toBe(101); // 150 unique + the null bucket
  });

  it('a rogue oversized grant is capped locally and the excess is counted, not kept', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const t = makeTelemetry({
      queueStore: store, online: true, posted: [], server,
      verdictFor: (events) => ({
        accepted: events.map((e) => e.client_event_id as string),
        duplicates: [],
        rejected: [],
        event_id_pool: Array.from({ length: 200 }, (_, i) => uuid(700000 + i)),
      }),
    });
    await t.init(); // pool 100 from bootstrap; init's heartbeat verdict grants 200 anyway -> capped
    expect(t.poolSize).toBe(150);
    expect(t.poolDropped).toBe(150);
  });
});

describe('request headers', () => {
  it('sends the publishable key as apikey only — never as a Bearer token', async () => {
    const store = new MemoryStore();
    const headersSeen: Record<string, string>[] = [];
    const t = makeTelemetry({ queueStore: store, online: true, posted: [], server: new FakeServer(), headersSeen });
    await t.init();
    expect(headersSeen.length).toBeGreaterThan(0);
    for (const h of headersSeen) {
      expect(h.apikey).toBe('sb_publishable_test');
      expect(h.authorization).toBeUndefined();
      expect(h['x-installation-secret']).toBeTruthy();
    }
  });
});
