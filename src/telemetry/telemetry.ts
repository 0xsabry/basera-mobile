/**
 * BASERA installation + OTA adoption telemetry (client core).
 *
 * Privacy contract (see docs/TELEMETRY.md): anonymous installations
 * only. The client collects NO user identity, NO location, NO
 * hardware identifiers.
 *
 * Identity is SERVER-ISSUED. This app ships no CSPRNG (expo-crypto is
 * not in the APK and no native dependency may be added for a metric),
 * and Math.random is forbidden for identifiers — so the installation
 * id, its secret, and every event id are minted by the server
 * (telemetry_bootstrap / verdict id pools) with the server's CSPRNG.
 * The client only stores what the server issued (secret in
 * SecureStore) and consumes pooled event ids. If the server has not
 * issued an identity yet (offline first launch), events queue locally
 * WITHOUT ids and are assigned pooled ids — persisted before sending —
 * at the first successful contact.
 *
 * Durability: every queue mutation runs through one serialized chain
 * and is persisted before the operation is considered done. flush()
 * never sends before the queue is durably stored, removes events only
 * after a server verdict, and reverts its in-memory state if the
 * post-verdict persist fails (a restart then resends; the server
 * dedupes on client_event_id).
 *
 * Overflow policy (explicit, counted, never silent):
 * - The queue holds at most QUEUE_CAP events and a QUEUED event is
 *   never dropped to make room.
 * - At capacity, incoming low-value events (update_check,
 *   update_available) are refused and counted.
 * - At capacity, an incoming critical event (update_downloaded,
 *   update_applied, update_failed) evicts the OLDEST queued
 *   update_check (else the oldest update_available) — counted.
 * - If nothing is evictable, the critical event is refused + counted.
 * - Counters persist in the telemetry state and are readable via
 *   `overflowStats`. The dead-letter store rotates at
 *   DEADLETTER_CAP with its own persisted `deadLetterDropped` count;
 *   dead-lettered events were already definitively refused by the
 *   server, so rotation loses local diagnostics only.
 */

export type TelemetryEventType =
  | 'update_check'
  | 'update_available'
  | 'update_downloaded'
  | 'update_applied'
  | 'update_failed';

export interface QueuedEvent {
  client_event_id: string | null;
  event_type: TelemetryEventType;
  update_id: string | null;
  status: 'ok' | 'failed';
  failure_reason: string | null;
  client_ts: string;
}

export interface InstallationFacts {
  platform: 'android' | 'ios';
  os_version: string | null;
  app_version: string | null;
  version_code: number | null;
  runtime_version: string | null;
  channel: string | null;
  current_update_id: string | null;
  is_embedded_launch: boolean;
}

export interface BootstrapResult {
  installation_id: string;
  installation_secret: string;
  event_id_pool: string[];
}

/** Per-event verdict returned by the ingest endpoint (HTTP 200).
 *  A null verdict (transport failure, oversized batch, auth or server
 *  error) means "keep the whole queue and retry later". */
export interface FlushVerdict {
  accepted: string[];
  duplicates: string[];
  rejected: { client_event_id: string | null; reason: string }[];
  event_id_pool?: string[];
}

export interface DeadLetterEntry {
  event: QueuedEvent;
  reason: string;
  dead_at: string;
}

export interface OverflowStats {
  refused: Record<string, number>;
  evicted: Record<string, number>;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface TelemetryDeps {
  secureStore: KeyValueStore;
  fallbackStore: KeyValueStore;
  post: (
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ) => Promise<FlushVerdict | null>;
  /** Ask the server to ISSUE an installation identity (CSPRNG). */
  requestBootstrap: (facts: InstallationFacts) => Promise<BootstrapResult | null>;
  endpoint: string | null;
  publishableKey: string | null;
  facts: () => InstallationFacts;
  now: () => Date;
}

const ID_KEY = 'basera.install.id';
const SECRET_KEY = 'basera.install.secret';
const QUEUE_KEY = 'basera.telemetry.queue.v1';
const STATE_KEY = 'basera.telemetry.state.v1';
const POOL_KEY = 'basera.telemetry.pool.v1';
const DEADLETTER_KEY = 'basera.telemetry.deadletter.v1';
export const QUEUE_CAP = 200;
export const DEADLETTER_CAP = 100;
const LOW_VALUE: TelemetryEventType[] = ['update_check', 'update_available'];
const EVICTABLE: TelemetryEventType[] = ['update_check', 'update_available'];

interface PersistedState {
  stagedUpdateId: string | null;
  appliedUpdateId: string | null;
  overflow: OverflowStats;
}

const emptyOverflow = (): OverflowStats => ({ refused: {}, evicted: {} });

export class Telemetry {
  private readonly deps: TelemetryDeps;
  private store: KeyValueStore | null = null;
  private identity: { id: string; secret: string } | null = null;
  private identityLoaded = false;
  private queue: QueuedEvent[] = [];
  private pool: string[] = [];
  private state: PersistedState = {
    stagedUpdateId: null,
    appliedUpdateId: null,
    overflow: emptyOverflow(),
  };
  private deadLetter: DeadLetterEntry[] = [];
  private deadLetterDroppedCount = 0;
  private loaded = false;
  private flushing = false;
  /** The single serialized work chain: all mutations, in order. */
  private tail: Promise<void> = Promise.resolve();

  constructor(deps: TelemetryDeps) {
    this.deps = deps;
  }

  // ---------------------------------------------------------------
  // plumbing
  // ---------------------------------------------------------------

  private async kv(): Promise<KeyValueStore> {
    if (this.store) return this.store;
    // Probe SecureStore with the identity keys; fall back to plain
    // storage only if it throws (telemetry never blocks the app).
    try {
      await this.deps.secureStore.get(ID_KEY);
      this.store = this.deps.secureStore;
    } catch {
      this.store = this.deps.fallbackStore;
    }
    return this.store;
  }

  /** Run work on the serialized chain. Resolves false on failure. */
  private chain(work: () => Promise<void>): Promise<boolean> {
    const run = this.tail.then(async () => {
      await work();
      return true;
    });
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.tail = settled;
    return run.then(
      () => true,
      () => false,
    );
  }

  private async loadAll(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const kv = await this.kv();
    try {
      const rawQ = await kv.get(QUEUE_KEY);
      this.queue = rawQ ? (JSON.parse(rawQ) as QueuedEvent[]) : [];
    } catch {
      this.queue = [];
    }
    try {
      const rawP = await kv.get(POOL_KEY);
      this.pool = rawP ? (JSON.parse(rawP) as string[]) : [];
    } catch {
      this.pool = [];
    }
    try {
      const rawS = await kv.get(STATE_KEY);
      if (rawS) {
        const parsed = JSON.parse(rawS) as Partial<PersistedState>;
        this.state = {
          stagedUpdateId: parsed.stagedUpdateId ?? null,
          appliedUpdateId: parsed.appliedUpdateId ?? null,
          overflow: {
            refused: parsed.overflow?.refused ?? {},
            evicted: parsed.overflow?.evicted ?? {},
          },
        };
      }
    } catch {
      /* keep defaults */
    }
    try {
      const rawD = await kv.get(DEADLETTER_KEY);
      if (rawD) {
        const parsed = JSON.parse(rawD) as
          | DeadLetterEntry[]
          | { entries: DeadLetterEntry[]; dropped: number };
        if (Array.isArray(parsed)) {
          this.deadLetter = parsed;
        } else {
          this.deadLetter = parsed.entries ?? [];
          this.deadLetterDroppedCount = parsed.dropped ?? 0;
        }
      }
    } catch {
      this.deadLetter = [];
    }
  }

  private async persistQueue(): Promise<void> {
    const kv = await this.kv();
    await kv.set(QUEUE_KEY, JSON.stringify(this.queue));
  }

  private async persistPool(): Promise<void> {
    const kv = await this.kv();
    await kv.set(POOL_KEY, JSON.stringify(this.pool));
  }

  private async persistState(): Promise<void> {
    const kv = await this.kv();
    await kv.set(STATE_KEY, JSON.stringify(this.state));
  }

  private async persistDeadLetter(): Promise<void> {
    const kv = await this.kv();
    await kv.set(
      DEADLETTER_KEY,
      JSON.stringify({
        entries: this.deadLetter.slice(-DEADLETTER_CAP),
        dropped: this.deadLetterDroppedCount,
      }),
    );
  }

  /** Persist every mutable store; throws on the first failure. */
  private async persistAll(): Promise<void> {
    await this.persistQueue();
    await this.persistPool();
    await this.persistState();
    await this.persistDeadLetter();
  }

  // ---------------------------------------------------------------
  // identity (server-issued)
  // ---------------------------------------------------------------

  private async ensureIdentity(): Promise<{ id: string; secret: string } | null> {
    if (this.identity) return this.identity;
    if (!this.identityLoaded) {
      this.identityLoaded = true;
      try {
        const kv = await this.kv();
        const id = await kv.get(ID_KEY);
        const secret = await kv.get(SECRET_KEY);
        if (id && secret) this.identity = { id, secret };
      } catch {
        /* treated as unissued */
      }
    }
    if (this.identity) return this.identity;
    if (!this.deps.endpoint || !this.deps.publishableKey) return null;
    const issued = await this.deps.requestBootstrap(this.deps.facts()).catch(() => null);
    if (!issued) return null;
    const kv = await this.kv();
    await kv.set(ID_KEY, issued.installation_id);
    await kv.set(SECRET_KEY, issued.installation_secret);
    this.identity = { id: issued.installation_id, secret: issued.installation_secret };
    if (Array.isArray(issued.event_id_pool) && issued.event_id_pool.length > 0) {
      this.pool = [...this.pool, ...issued.event_id_pool];
      await this.persistPool().catch(() => undefined);
    }
    return this.identity;
  }

  // ---------------------------------------------------------------
  // enqueue (durable, serialized, explicit overflow policy)
  // ---------------------------------------------------------------

  private async enqueueInternal(event: QueuedEvent): Promise<void> {
    await this.loadAll();
    if (this.queue.length >= QUEUE_CAP) {
      if (LOW_VALUE.includes(event.event_type)) {
        const r = this.state.overflow.refused;
        r[event.event_type] = (r[event.event_type] ?? 0) + 1;
        await this.persistState();
        return;
      }
      const victimIdx = EVICTABLE.map((t) =>
        this.queue.findIndex((e) => e.event_type === t),
      ).find((i) => i >= 0);
      if (victimIdx === undefined) {
        const r = this.state.overflow.refused;
        r[event.event_type] = (r[event.event_type] ?? 0) + 1;
        await this.persistState();
        return;
      }
      const [victim] = this.queue.splice(victimIdx, 1);
      const ev = this.state.overflow.evicted;
      ev[victim.event_type] = (ev[victim.event_type] ?? 0) + 1;
    }
    if (!event.client_event_id) {
      event.client_event_id = this.pool.shift() ?? null;
    }
    this.queue.push(event);
    await this.persistQueue();
    await this.persistState();
  }

  /** Queue one event durably. Resolves true once it is persisted. */
  record(input: {
    type: TelemetryEventType;
    updateId?: string | null;
    failureReason?: string | null;
  }): Promise<boolean> {
    const event: QueuedEvent = {
      client_event_id: null,
      event_type: input.type,
      update_id: input.updateId ?? null,
      status: input.type === 'update_failed' ? 'failed' : 'ok',
      failure_reason: input.failureReason ?? null,
      client_ts: this.deps.now().toISOString(),
    };
    return this.chain(() => this.enqueueInternal(event));
  }

  /**
   * Translate an UpdateService lifecycle event (the sink seam —
   * observational only; the update flow never waits on telemetry).
   * `applied` cannot be observed at download time: it is recognized
   * on a LATER launch whose running update id equals the staged
   * download (see checkAppliedOnLaunch). Resolves when the event is
   * durably queued.
   */
  handleUpdateEvent(e: {
    type: TelemetryEventType;
    updateId?: string | null;
    reason?: string;
  }): Promise<boolean> {
    const done = this.record({
      type: e.type,
      updateId: e.updateId ?? null,
      failureReason: e.type === 'update_failed' ? (e.reason ?? null) : null,
    });
    if (e.type === 'update_downloaded' && e.updateId) {
      const staged = e.updateId;
      void this.chain(async () => {
        await this.loadAll();
        this.state.stagedUpdateId = staged;
        await this.persistState();
      });
    }
    void this.flush();
    return done;
  }

  /**
   * Startup step: if the binary is now running an update that was
   * previously downloaded (or rolled back to embedded), record
   * `update_applied` exactly once for it.
   */
  async checkAppliedOnLaunch(current: {
    updateId: string | null;
    isEmbeddedLaunch: boolean;
  }): Promise<void> {
    await this.chain(async () => {
      await this.loadAll();
      const running = current.isEmbeddedLaunch ? 'rollback-to-embedded' : current.updateId;
      if (!running) {
        this.state.stagedUpdateId = null;
        await this.persistState();
        return;
      }
      if (running === this.state.appliedUpdateId) return;
      if (this.state.stagedUpdateId && running !== this.state.stagedUpdateId) {
        // Running something else entirely (a newer update superseded
        // the staged one before it ever launched): not an "applied"
        // for the staged id.
        this.state.stagedUpdateId = null;
        await this.persistState();
        return;
      }
      const isAppliedForStaged = this.state.stagedUpdateId === running;
      this.state.appliedUpdateId = running;
      this.state.stagedUpdateId = null;
      await this.persistState();
      if (isAppliedForStaged) {
        await this.enqueueInternal({
          client_event_id: null,
          event_type: 'update_applied',
          update_id: running === 'rollback-to-embedded' ? null : running,
          status: 'ok',
          failure_reason: null,
          client_ts: this.deps.now().toISOString(),
        });
      }
    });
  }

  // ---------------------------------------------------------------
  // flush
  // ---------------------------------------------------------------

  /**
   * Send queued events + the installation heartbeat (which carries the
   * current facts, so the same call registers first-seen facts after
   * bootstrap and refreshes last_seen afterwards). Never sends before
   * the local queue is durably persisted; applies the server verdict
   * exactly (accepted + duplicates removed, rate_limited kept,
   * other rejections dead-lettered, unaccounted kept) and persists
   * the result before reporting success.
   */
  flush(): Promise<boolean> {
    return this.chain(() => this.flushInternal());
  }

  private async flushInternal(): Promise<void> {
    if (this.flushing || !this.deps.endpoint || !this.deps.publishableKey) {
      throw new Error('flush unavailable');
    }
    this.flushing = true;
    try {
      await this.loadAll();
      // Durable-before-send: if the local stores cannot be written,
      // do not send anything (a crash must not be able to lose the
      // only copy of unsent events).
      await this.persistAll();

      const identity = await this.ensureIdentity();
      if (!identity) throw new Error('no identity');

      // Assign server-issued ids to any id-less events. If the pool
      // runs dry mid-assignment, fetch a top-up with a heartbeat
      // (empty batch) and continue.
      const assignFromPool = (): void => {
        for (const e of this.queue) {
          if (!e.client_event_id) e.client_event_id = this.pool.shift() ?? null;
        }
      };
      assignFromPool();
      if (this.queue.some((e) => !e.client_event_id)) {
        const topUp = await this.postBatch(identity, []);
        if (topUp?.event_id_pool?.length) {
          this.pool = [...this.pool, ...topUp.event_id_pool];
        }
        assignFromPool();
      }
      await this.persistQueue();
      await this.persistPool();

      const batch = this.queue.filter((e) => e.client_event_id).slice(0, 50);
      const verdict = await this.postBatch(identity, batch);
      if (!verdict) throw new Error('no verdict');

      const snapshot = {
        queue: this.queue,
        pool: this.pool,
        deadLetter: this.deadLetter,
        deadLetterDroppedCount: this.deadLetterDroppedCount,
      };
      if (verdict.event_id_pool?.length) {
        this.pool = [...this.pool, ...verdict.event_id_pool];
      }
      const drop = new Set([...verdict.accepted, ...verdict.duplicates]);
      const rejectedById = new Map(
        verdict.rejected
          .filter((r) => r.client_event_id)
          .map((r) => [r.client_event_id as string, r.reason]),
      );
      const sentIds = new Set(batch.map((e) => e.client_event_id as string));
      const remaining: QueuedEvent[] = [];
      const newlyDead: DeadLetterEntry[] = [];
      for (const e of this.queue) {
        if (!e.client_event_id || !sentIds.has(e.client_event_id)) {
          remaining.push(e);
          continue;
        }
        if (drop.has(e.client_event_id)) continue;
        const reason = rejectedById.get(e.client_event_id);
        if (reason === undefined || reason === 'rate_limited') {
          remaining.push(e);
        } else {
          newlyDead.push({ event: e, reason, dead_at: this.deps.now().toISOString() });
        }
      }
      this.queue = remaining;
      if (newlyDead.length > 0) {
        this.deadLetter = [...this.deadLetter, ...newlyDead];
        if (this.deadLetter.length > DEADLETTER_CAP) {
          this.deadLetterDroppedCount += this.deadLetter.length - DEADLETTER_CAP;
          this.deadLetter = this.deadLetter.slice(-DEADLETTER_CAP);
        }
      }
      try {
        await this.persistAll();
      } catch {
        // The verdict was applied in memory but could not be made
        // durable: revert, so this session and any restart resend
        // (the server dedupes on client_event_id).
        this.queue = snapshot.queue;
        this.pool = snapshot.pool;
        this.deadLetter = snapshot.deadLetter;
        this.deadLetterDroppedCount = snapshot.deadLetterDroppedCount;
        throw new Error('persist failed');
      }
    } finally {
      this.flushing = false;
    }
  }

  private async postBatch(
    identity: { id: string; secret: string },
    batch: QueuedEvent[],
  ): Promise<FlushVerdict | null> {
    if (!this.deps.endpoint || !this.deps.publishableKey) return null;
    try {
      return await this.deps.post(
        this.deps.endpoint,
        {
          'content-type': 'application/json',
          // The new Supabase publishable key travels in the apikey
          // header ONLY. It is not a JWT and is never sent as a
          // Bearer token; the installation secret (separate header)
          // is the installation's real credential.
          apikey: this.deps.publishableKey,
          'x-installation-id': identity.id,
          'x-installation-secret': identity.secret,
        },
        { installation: this.deps.facts(), events: batch },
      );
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------
  // diagnostics (used by tests; harmless in production)
  // ---------------------------------------------------------------

  get queuedCount(): number {
    return this.queue.length;
  }

  get deadLetterCount(): number {
    return this.deadLetter.length;
  }

  get deadLetterDropped(): number {
    return this.deadLetterDroppedCount;
  }

  get overflowStats(): OverflowStats {
    return this.state.overflow;
  }

  get issuedIdentity(): { id: string } | null {
    return this.identity ? { id: this.identity.id } : null;
  }

  /**
   * Init for app startup: durable load, applied-check (the currently
   * running update comes from the same facts source the heartbeat
   * uses), then the registration/heartbeat flush.
   */
  async init(): Promise<void> {
    await this.chain(() => this.loadAll());
    const facts = this.deps.facts();
    await this.checkAppliedOnLaunch({
      updateId: facts.current_update_id,
      isEmbeddedLaunch: facts.is_embedded_launch,
    });
    await this.flush();
  }
}
