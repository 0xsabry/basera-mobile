/**
 * Telemetry client tests — v5 (server-issued identity).
 *
 * The harness simulates the server honestly: bootstrap issues
 * DISTINCT identities/secrets/id pools per call (as the server's
 * CSPRNG would), and the post mock applies verdicts like the real
 * ingest function. Storage can be slowed and failed on demand for
 * the durability tests.
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
  async get(key: string): Promise<string | null> {
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
}

const OTA_U1 = { updateId: '11111111-2222-4333-8444-555555555555', isEmbeddedLaunch: false };

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
      event_id_pool: Array.from({ length: 500 }, (_, i) => uuid(n * 10000 + i)),
    };
  }
}

function makeTelemetry(opts: {
  store: MemoryStore;
  facts?: InstallationFacts;
  online: boolean;
  bootstrapOnline?: boolean;
  posted: PostedBatch[];
  server: FakeServer;
  verdictFor?: (events: QueuedEvent[]) => FlushVerdict | null;
  headersSeen?: Record<string, string>[];
}) {
  return new Telemetry({
    secureStore: opts.store,
    fallbackStore: opts.store,
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
      if (opts.verdictFor) return opts.verdictFor(batch.events);
      return {
        accepted: batch.events.map((e) => e.client_event_id as string),
        duplicates: [],
        rejected: [],
        event_id_pool: Array.from({ length: 50 }, (_, i) => uuid(900000 + i)),
      };
    },
  });
}

describe('server-issued identity', () => {
  it('bootstraps once, persists the issued identity, and reuses it on the next launch', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t1 = makeTelemetry({ store, online: true, posted, server });
    await t1.init();
    expect(server.bootstrapCalls).toBe(1);
    const issued = t1.issuedIdentity;
    expect(issued?.id).toBe(uuid(100001));
    expect(store.data.get('basera.install.id')).toBe(uuid(100001));
    expect(store.data.get('basera.install.secret')).toContain('server-secret-1-');

    const t2 = makeTelemetry({ store, online: true, posted, server });
    await t2.init();
    expect(server.bootstrapCalls).toBe(1); // reused, not re-issued
    expect(t2.issuedIdentity?.id).toBe(issued?.id);
  });

  it('two installations receive independent ids and secrets', async () => {
    const server = new FakeServer();
    const a = makeTelemetry({ store: new MemoryStore(), online: true, posted: [], server });
    const b = makeTelemetry({ store: new MemoryStore(), online: true, posted: [], server });
    await a.init();
    await b.init();
    expect(a.issuedIdentity?.id).not.toBe(b.issuedIdentity?.id);
    expect(server.bootstrapCalls).toBe(2);
  });

  it('never touches Math.random for identity, secrets, or event ids', async () => {
    const spy = jest.spyOn(Math, 'random');
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({ store, online: true, posted, server });
    await t.init();
    await t.record({ type: 'update_check' });
    await t.flush();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('update lifecycle', () => {
  it('applied is recorded once when the launched update matches the download', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t1 = makeTelemetry({
      store,
      online: true,
      posted,
      server,
      facts: makeFacts({ current_update_id: null }),
    });
    await t1.init();
    await t1.handleUpdateEvent({ type: 'update_check' });
    await t1.handleUpdateEvent({ type: 'update_available', updateId: OTA_U1.updateId });
    await t1.handleUpdateEvent({ type: 'update_downloaded', updateId: OTA_U1.updateId });
    await t1.flush();
    const firstEvents = posted.flatMap((b) => b.events).map((e) => e.event_type);
    expect(firstEvents).toContain('update_downloaded');
    expect(firstEvents).not.toContain('update_applied');

    const t2 = makeTelemetry({
      store,
      online: true,
      posted,
      server,
      facts: makeFacts({ current_update_id: OTA_U1.updateId, is_embedded_launch: false }),
    });
    await t2.init();
    const applied = posted
      .flatMap((b) => b.events)
      .filter((e) => e.event_type === 'update_applied');
    expect(applied).toHaveLength(1);
    expect(applied[0].update_id).toBe(OTA_U1.updateId);
    expect(applied[0].client_event_id).toBeTruthy();

    const before = posted.flatMap((b) => b.events).filter((e) => e.event_type === 'update_applied').length;
    const t3 = makeTelemetry({
      store,
      online: true,
      posted,
      server,
      facts: makeFacts({ current_update_id: OTA_U1.updateId, is_embedded_launch: false }),
    });
    await t3.init();
    const after = posted.flatMap((b) => b.events).filter((e) => e.event_type === 'update_applied').length;
    expect(after).toBe(before); // exactly once
  });

  it('queues events while offline (even un-issued) and delivers them after bootstrap, losing nothing', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const offline = makeTelemetry({ store, online: false, posted, server });
    await offline.record({ type: 'update_check' });
    await offline.record({ type: 'update_failed', failureReason: 'network unreachable' });
    expect(await offline.flush()).toBe(false);
    const persisted = JSON.parse(store.data.get('basera.telemetry.queue.v1') as string) as QueuedEvent[];
    expect(persisted).toHaveLength(2);
    expect(server.bootstrapCalls).toBe(0); // never reached the server

    const online = makeTelemetry({ store, online: true, posted, server });
    await online.init();
    const delivered = posted.flatMap((b) => b.events);
    expect(delivered.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['update_check', 'update_failed']),
    );
    expect(delivered[1].failure_reason).toBe('network unreachable');
    // Ids were server-issued at first contact and are real, unique ids.
    const ids = delivered.map((e) => e.client_event_id);
    expect(ids.every((i) => typeof i === 'string' && i.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(online.queuedCount).toBe(0);
  });
});

describe('server verdicts', () => {
  const verdictSetup = (verdictFor: (events: QueuedEvent[]) => FlushVerdict | null) => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({ store, online: true, posted, server, verdictFor });
    return { store, server, posted, t };
  };

  it('a definitively rejected event leaves the queue into the dead-letter store, kept locally', async () => {
    const { store, t } = verdictSetup((events) => ({
      accepted: [],
      duplicates: [],
      rejected: events.map((e) => ({ client_event_id: e.client_event_id, reason: 'invalid_update_id' })),
    }));
    await t.init();
    await t.handleUpdateEvent({ type: 'update_available', updateId: 'not-a-uuid' });
    await t.flush();
    expect(t.queuedCount).toBe(0);
    expect(t.deadLetterCount).toBe(1);
    const dead = JSON.parse(store.data.get('basera.telemetry.deadletter.v1') as string) as {
      entries: { reason: string }[];
    };
    expect(dead.entries[0].reason).toBe('invalid_update_id');
  });

  it('a rate_limited rejection keeps the event queued for a later flush', async () => {
    const { t } = verdictSetup((events) => ({
      accepted: [],
      duplicates: [],
      rejected: events.map((e) => ({ client_event_id: e.client_event_id, reason: 'rate_limited' })),
    }));
    await t.init();
    await t.handleUpdateEvent({ type: 'update_check' });
    await t.flush();
    expect(t.queuedCount).toBe(1);
    expect(t.deadLetterCount).toBe(0);
  });

  it('duplicates are removed like accepted, never dead-lettered', async () => {
    const { t } = verdictSetup((events) => ({
      accepted: [],
      duplicates: events.map((e) => e.client_event_id as string),
      rejected: [],
    }));
    await t.init();
    await t.handleUpdateEvent({ type: 'update_check' });
    await t.flush();
    expect(t.queuedCount).toBe(0);
    expect(t.deadLetterCount).toBe(0);
  });
});

describe('overflow policy', () => {
  it('refuses low-value events at capacity and counts them — queued events are never dropped', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const t = makeTelemetry({ store, online: false, posted: [], server });
    for (let i = 0; i < 210; i++) await t.record({ type: 'update_check' });
    expect(t.queuedCount).toBe(200);
    expect(t.overflowStats.refused.update_check).toBe(10);
    expect(t.overflowStats.evicted.update_check ?? 0).toBe(0);
    // The accounting identity: every offered event is queued, refused, or evicted.
    const persisted = JSON.parse(store.data.get('basera.telemetry.queue.v1') as string) as QueuedEvent[];
    expect(persisted).toHaveLength(200);
  });

  it('a critical event evicts the oldest low-value event (counted), never a queued critical one', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const t = makeTelemetry({ store, online: false, posted: [], server });
    for (let i = 0; i < 200; i++) await t.record({ type: 'update_check' });
    await t.record({ type: 'update_applied', updateId: OTA_U1.updateId });
    expect(t.queuedCount).toBe(200);
    expect(t.overflowStats.evicted.update_check).toBe(1);
    const persisted = JSON.parse(store.data.get('basera.telemetry.queue.v1') as string) as QueuedEvent[];
    expect(persisted.some((e) => e.event_type === 'update_applied')).toBe(true);
    expect(persisted.filter((e) => e.event_type === 'update_check')).toHaveLength(199);
  });

  it('dead-letter rotation is capped and counted, not silent', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({
      store,
      online: true,
      posted,
      server,
      verdictFor: (events) => ({
        accepted: [],
        duplicates: [],
        rejected: events.map((e) => ({ client_event_id: e.client_event_id, reason: 'invalid_event_type' })),
      }),
    });
    await t.init();
    for (let i = 0; i < 105; i++) {
      await t.record({ type: 'update_failed', failureReason: 'x' });
    }
    await t.flush();
    await t.flush();
    await t.flush();
    expect(t.deadLetterCount).toBe(100);
    expect(t.deadLetterDropped).toBe(5);
  });
});

describe('durability', () => {
  it('record() resolves only after the event is persisted', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    let release!: () => void;
    store.gate = new Promise<void>((r) => (release = r));
    const t = makeTelemetry({ store, online: true, posted: [], server });
    let resolved = false;
    const p = t.record({ type: 'update_check' }).then((ok) => {
      resolved = true;
      return ok;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false); // still waiting on the storage write
    release();
    await expect(p).resolves.toBe(true);
    const persisted = JSON.parse(store.data.get('basera.telemetry.queue.v1') as string) as QueuedEvent[];
    expect(persisted).toHaveLength(1);
  });

  it('flush refuses to send when the queue cannot be persisted first', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({ store, online: true, posted, server });
    await t.record({ type: 'update_check' });
    store.failSets = 1000; // every write now fails
    expect(await t.flush()).toBe(false);
    expect(posted).toHaveLength(0); // nothing was sent on an undurable queue
  });

  it('a crash before the post-verdict persist resends the same events (server dedupes)', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const posted: PostedBatch[] = [];
    // The verdict itself arms the crash: the very next storage write
    // (the post-verdict persist) fails, simulating a crash there.
    let crashArmed = false;
    const t1 = makeTelemetry({
      store,
      online: true,
      posted,
      server,
      verdictFor: (events) => {
        if (events.length > 0) crashArmed = true; // not on init's heartbeat
        return {
          accepted: events.map((e) => e.client_event_id as string),
          duplicates: [],
          rejected: [],
        };
      },
    });
    await t1.init();
    await t1.record({ type: 'update_check' });
    const realSet = store.set.bind(store);
    store.set = async (k: string, v: string) => {
      if (crashArmed) {
        crashArmed = false;
        throw new Error('crash during persist');
      }
      return realSet(k, v);
    };
    expect(await t1.flush()).toBe(false);
    const sentFirst = posted.flatMap((b) => b.events).map((e) => e.client_event_id);
    expect(sentFirst).toHaveLength(1);

    // Restart on the same store: the events are still queued locally.
    store.set = realSet;
    const t2 = makeTelemetry({ store, online: true, posted, server });
    await t2.init();
    const sentSecond = posted.flatMap((b) => b.events).map((e) => e.client_event_id);
    expect(sentSecond.filter((id) => id === sentFirst[0])).toHaveLength(2); // resent with the SAME id
    expect(t2.queuedCount).toBe(0);
  });
});

describe('request headers', () => {
  it('sends the publishable key as apikey only — never as a Bearer token', async () => {
    const store = new MemoryStore();
    const server = new FakeServer();
    const headersSeen: Record<string, string>[] = [];
    const t = makeTelemetry({ store, online: true, posted: [], server, headersSeen });
    await t.init();
    expect(headersSeen.length).toBeGreaterThan(0);
    for (const h of headersSeen) {
      expect(h.apikey).toBe('sb_publishable_test');
      expect(h.authorization).toBeUndefined();
      expect(h['x-installation-secret']).toBeTruthy();
    }
  });
});
