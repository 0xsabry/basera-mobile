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
 * If the server has not issued an identity yet (offline first
 * launch), events queue locally WITHOUT ids and are assigned pooled
 * ids — persisted before sending — at the first successful contact.
 *
 * Storage architecture (v7):
 * - ALL mutable telemetry state (queue, id pool, lifecycle state,
 *   overflow counters, dead-letter) lives in ONE Atomic State
 *   Envelope — a single key in the queue store, written with a
 *   single set() per mutation. There is no multi-key transaction to
 *   tear: a crash leaves either the whole old envelope or the whole
 *   new one, so an event id can never be consumed without that
 *   consumption being durable, and ids are never reused.
 * - The installation identity (id + secret together) is a SINGLE
 *   value in SecureStore ONLY — it is never written to plain
 *   storage. If SecureStore is unavailable, events keep queueing in
 *   the envelope but NOTHING is sent (and no bootstrap is requested,
 *   since its result could not be stored). An issued identity whose
 *   save fails is NOT adopted in memory; the next attempt re-reads
 *   local storage first and only then asks the server again.
 *
 * Durability: every mutation runs through one serialized chain and
 * is persisted (one envelope write) before the operation counts as
 * done. flush() never sends before the state is durably stored,
 * removes events only after a server verdict, and reverts its
 * in-memory state if the post-verdict persist fails (a restart then
 * resends; the server dedupes on client_event_id).
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
 * - Counters persist in the envelope and are readable via
 *   `overflowStats`. The dead-letter store rotates at
 *   DEADLETTER_CAP with its own persisted drop count; dead-lettered
 *   events were already definitively refused by the server, so
 *   rotation loses local diagnostics only.
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
  /** Tri-state: true/false when the value is known; null = unknown
   *  (expo-updates unavailable or unreadable). Unknown is NEVER
   *  fabricated into a boolean anywhere in the pipeline. */
  is_embedded_launch: boolean | null;
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
  /** Envelope store (plain storage is fine: no secrets inside). */
  queueStore: KeyValueStore;
  /** SecureStore — used for the installation identity ONLY. */
  secureStore: KeyValueStore;
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

const ENVELOPE_KEY = 'basera.telemetry.envelope.v1';
const ENVELOPE_CORRUPT_KEY = 'basera.telemetry.envelope.corrupt';
const IDENTITY_KEY = 'basera.install.identity.v1';
// NOTE: there is intentionally NO migration from the short-lived v5
// storage layout. The v5 client was never distributed: the last
// published OTA predates the first telemetry commit, and no APK
// contains telemetry code (proof in docs/TELEMETRY.md). Client
// storage begins with this envelope.

export const QUEUE_CAP = 200;
export const DEADLETTER_CAP = 100;
/** Pool economics: the client asks the server for ids ONLY when the
 *  local pool falls below POOL_LOW_WATER, sized to refill to
 *  POOL_TARGET; the server clamps any grant to at most 100, and the
 *  local pool is hard-capped at POOL_MAX (excess grants are counted
 *  in poolDropped, never silently kept or silently lost). */
export const POOL_TARGET = 100;
export const POOL_LOW_WATER = 20;
export const POOL_MAX = 150;
const LOW_VALUE: TelemetryEventType[] = ['update_check', 'update_available'];
const EVICTABLE: TelemetryEventType[] = ['update_check', 'update_available'];

interface Envelope {
  version: 1;
  queue: QueuedEvent[];
  pool: string[];
  stagedUpdateId: string | null;
  appliedUpdateId: string | null;
  overflow: OverflowStats;
  deadLetter: DeadLetterEntry[];
  deadLetterDropped: number;
  /** Server-granted ids discarded by the local pool cap (counted,
   *  never silent; discarded ids were never used, so nothing is
   *  lost but spare capacity). */
  poolDropped: number;
}

const freshEnvelope = (): Envelope => ({
  version: 1,
  queue: [],
  pool: [],
  stagedUpdateId: null,
  appliedUpdateId: null,
  overflow: { refused: {}, evicted: {} },
  deadLetter: [],
  deadLetterDropped: 0,
  poolDropped: 0,
});

export class Telemetry {
  private readonly deps: TelemetryDeps;
  private env: Envelope = freshEnvelope();
  private loaded = false;
  private identity: { id: string; secret: string } | null = null;
  private flushing = false;
  /** The single serialized work chain: all mutations, in order. */
  private tail: Promise<void> = Promise.resolve();

  constructor(deps: TelemetryDeps) {
    this.deps = deps;
  }

  // ---------------------------------------------------------------
  // envelope load / persist (ONE key, ONE write per mutation)
  // ---------------------------------------------------------------

  /**
   * Load the envelope. FAIL-CLOSED: returns false (and `loaded`
   * stays false, so the next operation retries) when the storage
   * read fails or a corrupt envelope cannot be quarantined. While
   * blocked, NOTHING proceeds: no bootstrap, no ingest, no writes —
   * an unreadable store is never mistaken for an empty one, and the
   * original bytes are never overwritten blind.
   */
  private async loadAll(): Promise<boolean> {
    if (this.loaded) return true;
    const store = this.deps.queueStore;
    let raw: string | null;
    try {
      raw = await store.get(ENVELOPE_KEY);
    } catch {
      return false; // storage unreadable: blocked until it recovers
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Envelope;
        if (parsed.version !== 1 || !Array.isArray(parsed.queue) || !Array.isArray(parsed.pool)) {
          throw new Error('bad envelope shape');
        }
        this.env = { ...freshEnvelope(), ...parsed };
      } catch {
        // Corrupt envelope: quarantine the raw bytes for diagnosis.
        // If even the quarantine write fails, stay blocked rather
        // than starting fresh and overwriting the only copy.
        try {
          await store.set(ENVELOPE_CORRUPT_KEY, raw);
        } catch {
          return false;
        }
        this.env = freshEnvelope();
      }
    } else {
      this.env = freshEnvelope();
    }
    this.loaded = true;
    return true;
  }

  /** Append server-granted ids, hard-capped; excess counted. */
  private appendPool(ids: string[]): void {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const room = Math.max(POOL_MAX - this.env.pool.length, 0);
    const take = ids.slice(0, room);
    this.env.poolDropped += ids.length - take.length;
    this.env.pool.push(...take);
  }

  /** How many ids to ask the server for right now (0 = ask for
   *  nothing: a heartbeat must not inflate the pool). */
  private poolRequestSize(): number {
    if (this.env.pool.length >= POOL_LOW_WATER) return 0;
    return Math.min(POOL_TARGET - this.env.pool.length, 100);
  }

  /** The ONLY write path for telemetry state: one key, one set(). */
  private async persist(): Promise<void> {
    await this.deps.queueStore.set(ENVELOPE_KEY, JSON.stringify(this.env));
  }

  /** Run work on the serialized chain. Resolves false on failure. */
  private chain(work: () => Promise<void>): Promise<boolean> {
    const run = this.tail.then(async () => {
      await work();
      return true;
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run.then(
      () => true,
      () => false,
    );
  }

  // ---------------------------------------------------------------
  // identity (SecureStore ONLY, single value, never adopted unsaved)
  // ---------------------------------------------------------------

  /** Read the stored identity from SecureStore. Throws only via the
   *  `unreadable` flag: a store error is distinguished from absence. */
  private async readStoredIdentity(): Promise<
    { kind: 'found'; identity: { id: string; secret: string } } | { kind: 'absent' } | { kind: 'unreadable' }
  > {
    let raw: string | null;
    try {
      raw = await this.deps.secureStore.get(IDENTITY_KEY);
    } catch {
      return { kind: 'unreadable' };
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { id?: unknown; secret?: unknown };
        if (typeof parsed.id === 'string' && typeof parsed.secret === 'string') {
          return { kind: 'found', identity: { id: parsed.id, secret: parsed.secret } };
        }
      } catch {
        /* malformed value: treated as absent and overwritten later */
      }
      return { kind: 'absent' };
    }
    return { kind: 'absent' };
  }

  private async ensureIdentity(): Promise<{ id: string; secret: string } | null> {
    if (this.identity) return this.identity;
    // Always try local restoration BEFORE asking the server again.
    const stored = await this.readStoredIdentity();
    if (stored.kind === 'found') {
      this.identity = stored.identity;
      return this.identity;
    }
    if (stored.kind === 'unreadable') {
      // SecureStore cannot be read: do not bootstrap (the result
      // could not be stored) and do not send. Queueing continues.
      return null;
    }
    if (!this.deps.endpoint || !this.deps.publishableKey) return null;
    const issued = await this.deps.requestBootstrap(this.deps.facts()).catch(() => null);
    if (!issued) return null;
    const identity = { id: issued.installation_id, secret: issued.installation_secret };
    try {
      await this.deps.secureStore.set(IDENTITY_KEY, JSON.stringify(identity));
    } catch {
      // NOT adopted: an identity that exists only in memory (and on
      // the server) would strand its events on restart. The next
      // flush re-reads storage first, then re-bootstraps if needed
      // (the orphaned server row stays dormant forever).
      return null;
    }
    this.identity = identity;
    if (Array.isArray(issued.event_id_pool) && issued.event_id_pool.length > 0) {
      this.appendPool(issued.event_id_pool);
      await this.persist().catch(() => undefined);
    }
    return this.identity;
  }

  // ---------------------------------------------------------------
  // enqueue (durable, serialized, explicit overflow policy)
  // ---------------------------------------------------------------

  private async enqueueInternal(event: QueuedEvent): Promise<void> {
    if (!(await this.loadAll())) throw new Error('storage blocked');
    if (this.env.queue.length >= QUEUE_CAP) {
      if (LOW_VALUE.includes(event.event_type)) {
        const r = this.env.overflow.refused;
        r[event.event_type] = (r[event.event_type] ?? 0) + 1;
        await this.persist();
        return;
      }
      const victimIdx = EVICTABLE.map((t) =>
        this.env.queue.findIndex((e) => e.event_type === t),
      ).find((i) => i >= 0);
      if (victimIdx === undefined) {
        const r = this.env.overflow.refused;
        r[event.event_type] = (r[event.event_type] ?? 0) + 1;
        await this.persist();
        return;
      }
      const [victim] = this.env.queue.splice(victimIdx, 1);
      const ev = this.env.overflow.evicted;
      ev[victim.event_type] = (ev[victim.event_type] ?? 0) + 1;
    }
    if (!event.client_event_id) {
      event.client_event_id = this.env.pool.shift() ?? null;
    }
    this.env.queue.push(event);
    // ONE envelope write: the event AND the consumed pool id (and any
    // counter change) become durable together — a restart can never
    // resurrect a consumed id.
    await this.persist();
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
        if (!(await this.loadAll())) return;
        this.env.stagedUpdateId = staged;
        await this.persist();
      });
    }
    void this.flush();
    return done;
  }

  /**
   * Startup step: if the binary is now running an update that was
   * previously downloaded (or rolled back to embedded), record
   * `update_applied` exactly once for it. With an UNKNOWN embedded
   * state and no running update id, nothing is decided and the
   * staged state is preserved for a later, knowable launch.
   */
  async checkAppliedOnLaunch(current: {
    updateId: string | null;
    isEmbeddedLaunch: boolean | null;
  }): Promise<void> {
    await this.chain(async () => {
      if (!(await this.loadAll())) return;
      if (current.isEmbeddedLaunch === null && !current.updateId) {
        return; // state unknown: decide nothing, keep staged as-is
      }
      const running =
        current.isEmbeddedLaunch === true ? 'rollback-to-embedded' : current.updateId;
      if (!running) {
        this.env.stagedUpdateId = null;
        await this.persist();
        return;
      }
      if (running === this.env.appliedUpdateId) return;
      const isAppliedForStaged = this.env.stagedUpdateId === running;
      this.env.appliedUpdateId = running;
      this.env.stagedUpdateId = null;
      if (isAppliedForStaged) {
        // enqueueInternal persists the whole envelope (including the
        // lifecycle transition above) in its own single write.
        await this.enqueueInternal({
          client_event_id: null,
          event_type: 'update_applied',
          update_id: running === 'rollback-to-embedded' ? null : running,
          status: 'ok',
          failure_reason: null,
          client_ts: this.deps.now().toISOString(),
        });
      } else {
        await this.persist();
      }
    });
  }

  // ---------------------------------------------------------------
  // flush
  // ---------------------------------------------------------------

  /**
   * Send queued events + the installation heartbeat. Never sends
   * before the local state is durably persisted; applies the server
   * verdict exactly (accepted + duplicates removed, rate_limited
   * kept, other rejections dead-lettered, unaccounted kept) and
   * persists the result before reporting success.
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
      if (!(await this.loadAll())) throw new Error('storage blocked');
      // Durable-before-send: if the envelope cannot be written, do
      // not send anything (a crash must not lose the only copy).
      await this.persist();

      const identity = await this.ensureIdentity();
      if (!identity) throw new Error('no identity');

      // Assign server-issued ids to any id-less events. If the pool
      // runs dry mid-assignment, fetch a top-up with a heartbeat
      // (empty batch) and continue.
      const assignFromPool = (): void => {
        for (const e of this.env.queue) {
          if (!e.client_event_id) e.client_event_id = this.env.pool.shift() ?? null;
        }
      };
      assignFromPool();
      // ONE sized request per flush, spent exactly once: if a
      // top-up heartbeat is needed (events are waiting for ids), IT
      // carries the request and the batch post that follows carries
      // ZERO — a single flush must never be granted the same request
      // twice. If the top-up fails, nothing is assumed: id-less
      // events simply stay queued (they are never dropped), and the
      // batch still sends the events that do have ids, with no
      // further request attached.
      let poolRequest = this.poolRequestSize();
      if (this.env.queue.some((e) => !e.client_event_id)) {
        const topUp = await this.postBatch(identity, [], poolRequest);
        poolRequest = 0; // spent — regardless of the top-up outcome
        if (topUp?.event_id_pool?.length) this.appendPool(topUp.event_id_pool);
        assignFromPool();
      }
      await this.persist();

      const batch = this.env.queue.filter((e) => e.client_event_id).slice(0, 50);
      const verdict = await this.postBatch(identity, batch, poolRequest);
      if (!verdict) throw new Error('no verdict');

      const snapshot = JSON.stringify(this.env);
      if (verdict.event_id_pool?.length) this.appendPool(verdict.event_id_pool);
      const drop = new Set([...verdict.accepted, ...verdict.duplicates]);
      const rejectedById = new Map(
        verdict.rejected
          .filter((r) => r.client_event_id)
          .map((r) => [r.client_event_id as string, r.reason]),
      );
      const sentIds = new Set(batch.map((e) => e.client_event_id as string));
      const remaining: QueuedEvent[] = [];
      const newlyDead: DeadLetterEntry[] = [];
      for (const e of this.env.queue) {
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
      this.env.queue = remaining;
      if (newlyDead.length > 0) {
        this.env.deadLetter = [...this.env.deadLetter, ...newlyDead];
        if (this.env.deadLetter.length > DEADLETTER_CAP) {
          this.env.deadLetterDropped += this.env.deadLetter.length - DEADLETTER_CAP;
          this.env.deadLetter = this.env.deadLetter.slice(-DEADLETTER_CAP);
        }
      }
      try {
        await this.persist();
      } catch {
        // The verdict was applied in memory but could not be made
        // durable: revert to the pre-verdict envelope, so this
        // session and any restart resend (server dedupes).
        this.env = JSON.parse(snapshot) as Envelope;
        throw new Error('persist failed');
      }
    } finally {
      this.flushing = false;
    }
  }

  private async postBatch(
    identity: { id: string; secret: string },
    batch: QueuedEvent[],
    poolRequest = 0,
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
        { installation: this.deps.facts(), events: batch, pool_request: poolRequest },
      );
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------
  // diagnostics (used by tests; harmless in production)
  // ---------------------------------------------------------------

  get queuedCount(): number {
    return this.env.queue.length;
  }

  get deadLetterCount(): number {
    return this.env.deadLetter.length;
  }

  get deadLetterDropped(): number {
    return this.env.deadLetterDropped;
  }

  get overflowStats(): OverflowStats {
    return this.env.overflow;
  }

  get poolSize(): number {
    return this.env.pool.length;
  }

  get poolDropped(): number {
    return this.env.poolDropped;
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
    await this.chain(async () => {
      await this.loadAll();
    });
    const facts = this.deps.facts();
    await this.checkAppliedOnLaunch({
      updateId: facts.current_update_id,
      isEmbeddedLaunch: facts.is_embedded_launch,
    });
    await this.flush();
  }
}
