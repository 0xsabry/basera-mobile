/**
 * Telemetry acceptance tests (client side):
 *  1. First launch creates ONE installation identity; later launches
 *     reuse it — the same installation is never counted twice.
 *  2. update_downloaded and update_applied are separate events, and
 *     applied fires exactly once, only when a later launch is actually
 *     RUNNING the downloaded update (Updates.updateId match).
 *  3. Offline: failed flushes keep the queue; the same client_event_id
 *     values are retried later — no loss, no duplication.
 */
import { Telemetry, type InstallationFacts, type KeyValueStore, type QueuedEvent } from '../telemetry';

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
}

interface PostedBatch {
  installation: InstallationFacts;
  events: QueuedEvent[];
}

function makeFacts(overrides: Partial<InstallationFacts> = {}): InstallationFacts {
  return {
    platform: 'android',
    os_version: '34',
    app_version: '1.1.8',
    version_code: 10,
    runtime_version: '1.1.0',
    channel: 'preview',
    current_update_id: null,
    is_embedded_launch: true,
    ...overrides,
  };
}

function makeTelemetry(opts: {
  store: MemoryStore;
  facts: InstallationFacts;
  online: boolean;
  posted: PostedBatch[];
  verdictFor?: (events: QueuedEvent[]) => {
    accepted: string[];
    duplicates: string[];
    rejected: { client_event_id: string | null; reason: string }[];
  } | null;
}) {
  return new Telemetry({
    secureStore: opts.store,
    fallbackStore: opts.store,
    endpoint: 'https://example.test/functions/v1/telemetry-ingest',
    publishableKey: 'sb_publishable_test',
    facts: () => opts.facts,
    now: () => new Date('2026-11-01T12:00:00.000Z'),
    post: async (_url, _headers, body) => {
      if (!opts.online) return null;
      const batch = body as PostedBatch;
      opts.posted.push(batch);
      if (opts.verdictFor) return opts.verdictFor(batch.events);
      return {
        accepted: batch.events.map((e) => e.client_event_id),
        duplicates: [],
        rejected: [],
      };
    },
  });
}

describe('installation identity', () => {
  it('is created once and reused across launches (never double-counted)', async () => {
    const store = new MemoryStore();
    const posted: PostedBatch[] = [];
    const t1 = makeTelemetry({ store, facts: makeFacts(), online: true, posted });
    await t1.init();
    const id1 = await t1.ensureIdentity();

    const t2 = makeTelemetry({ store, facts: makeFacts(), online: true, posted });
    await t2.init();
    const id2 = await t2.ensureIdentity();

    expect(id2.id).toBe(id1.id);
    expect(id2.secret).toBe(id1.secret);
    expect(id1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('downloaded vs applied', () => {
  it('records applied exactly once, at the launch that runs the downloaded update', async () => {
    const store = new MemoryStore();
    const posted: PostedBatch[] = [];

    // Launch 1: embedded; a check finds and downloads update U.
    const t1 = makeTelemetry({ store, facts: makeFacts(), online: true, posted });
    await t1.init();
    t1.handleUpdateEvent({ type: 'update_check' });
    t1.handleUpdateEvent({ type: 'update_available', updateId: 'U' });
    t1.handleUpdateEvent({ type: 'update_downloaded', updateId: 'U' });
    await t1.flush();
    const launch1Types = posted.flatMap((b) => b.events.map((e) => e.event_type));
    expect(launch1Types).toContain('update_downloaded');
    expect(launch1Types).not.toContain('update_applied');

    // Launch 2: the device restarted and is now RUNNING update U.
    const t2 = makeTelemetry({
      store,
      facts: makeFacts({ current_update_id: 'U', is_embedded_launch: false }),
      online: true,
      posted,
    });
    posted.length = 0;
    await t2.init();
    const launch2 = posted.flatMap((b) => b.events);
    const applied = launch2.filter((e) => e.event_type === 'update_applied');
    expect(applied).toHaveLength(1);
    expect(applied[0].update_id).toBe('U');

    // Launch 3: still running U — no second applied event.
    const t3 = makeTelemetry({
      store,
      facts: makeFacts({ current_update_id: 'U', is_embedded_launch: false }),
      online: true,
      posted,
    });
    posted.length = 0;
    await t3.init();
    const launch3Types = posted.flatMap((b) => b.events.map((e) => e.event_type));
    expect(launch3Types).not.toContain('update_applied');
  });

  it('does not claim applied when the restart lands on a different update', async () => {
    const store = new MemoryStore();
    const posted: PostedBatch[] = [];
    const t1 = makeTelemetry({ store, facts: makeFacts(), online: true, posted });
    await t1.init();
    t1.handleUpdateEvent({ type: 'update_downloaded', updateId: 'U' });
    await t1.flush();

    const t2 = makeTelemetry({
      store,
      facts: makeFacts({ current_update_id: 'V', is_embedded_launch: false }),
      online: true,
      posted,
    });
    posted.length = 0;
    await t2.init();
    const applied = posted.flatMap((b) => b.events).filter((e) => e.event_type === 'update_applied');
    // The running bundle changed (V, not the staged U): recorded as an
    // applied transition for V, never as U having applied.
    expect(applied.every((e) => e.update_id !== 'U')).toBe(true);
  });
});

describe('offline queue', () => {
  it('keeps events through failed flushes and delivers the same event ids later', async () => {
    const store = new MemoryStore();
    const posted: PostedBatch[] = [];
    const offline = makeTelemetry({ store, facts: makeFacts(), online: false, posted });
    await offline.init();
    offline.handleUpdateEvent({ type: 'update_check' });
    offline.handleUpdateEvent({
      type: 'update_failed',
      updateId: null,
      reason: 'network unreachable',
    });
    expect(await offline.flush()).toBe(false);
    expect(offline.queuedCount).toBe(2);
    const persistedIds = (
      JSON.parse(store.data.get('basera.telemetry.queue.v1') as string) as QueuedEvent[]
    ).map((e) => e.client_event_id);
    expect(persistedIds).toHaveLength(2);

    // Next launch, connectivity back: the persisted queue is loaded
    // and delivered with the SAME client_event_id values (the server
    // dedupes on them, so a retry can never double-count).
    const online = makeTelemetry({ store, facts: makeFacts(), online: true, posted });
    await online.init();
    const delivered = posted.flatMap((b) => b.events);
    expect(delivered.map((e) => e.client_event_id)).toEqual(persistedIds);
    expect(delivered[1].failure_reason).toBe('network unreachable');
    expect(online.queuedCount).toBe(0);
  });
});

describe('server verdicts', () => {
  it('a definitively rejected event leaves the queue into the dead-letter store, kept locally', async () => {
    const store = new MemoryStore();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({
      store,
      facts: makeFacts(),
      online: true,
      posted,
      verdictFor: (events) => ({
        accepted: [],
        duplicates: [],
        rejected: events.map((e) => ({
          client_event_id: e.client_event_id,
          reason: 'invalid_update_id',
        })),
      }),
    });
    await t.init();
    t.handleUpdateEvent({ type: 'update_available', updateId: 'not-a-uuid' });
    await t.flush();
    await new Promise((r) => setTimeout(r, 10));
    expect(t.queuedCount).toBe(0);
    expect(t.deadLetterCount).toBe(1);
    const dead = JSON.parse(store.data.get('basera.telemetry.deadletter.v1') as string) as {
      reason: string;
    }[];
    expect(dead[0].reason).toBe('invalid_update_id');
  });

  it('a rate_limited rejection keeps the event queued for a later flush', async () => {
    const store = new MemoryStore();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({
      store,
      facts: makeFacts(),
      online: true,
      posted,
      verdictFor: (events) => ({
        accepted: [],
        duplicates: [],
        rejected: events.map((e) => ({
          client_event_id: e.client_event_id,
          reason: 'rate_limited',
        })),
      }),
    });
    await t.init();
    t.handleUpdateEvent({ type: 'update_check' });
    await t.flush();
    await new Promise((r) => setTimeout(r, 10));
    expect(t.queuedCount).toBe(1);
    expect(t.deadLetterCount).toBe(0);
  });

  it('duplicates are removed like accepted, never dead-lettered', async () => {
    const store = new MemoryStore();
    const posted: PostedBatch[] = [];
    const t = makeTelemetry({
      store,
      facts: makeFacts(),
      online: true,
      posted,
      verdictFor: (events) => ({
        accepted: [],
        duplicates: events.map((e) => e.client_event_id),
        rejected: [],
      }),
    });
    await t.init();
    t.handleUpdateEvent({ type: 'update_check' });
    await t.flush();
    await new Promise((r) => setTimeout(r, 10));
    expect(t.queuedCount).toBe(0);
    expect(t.deadLetterCount).toBe(0);
  });
});
