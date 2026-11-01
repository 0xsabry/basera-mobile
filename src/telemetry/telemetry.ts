/**
 * Installations & OTA adoption telemetry (owner dashboard).
 *
 * Privacy contract (owner-approved):
 * - One random, anonymous Installation ID per install, generated on
 *   first launch and persisted in SecureStore (AsyncStorage fallback).
 *   It is NEVER linked to the user's identity, account, or guardian
 *   data, and no IMEI / location / contacts / device identifiers are
 *   collected — only app/update facts the owner needs to run the
 *   release: app version, build number, runtime, channel, platform,
 *   and OTA lifecycle events.
 * - Every event carries a client-generated UUID; the ingest function
 *   deduplicates on it, so retries never double-count.
 * - Events are queued locally and flushed opportunistically (launch,
 *   app foreground, after each update event). A failed flush keeps the
 *   queue — nothing is lost when the device is offline.
 * - Telemetry NEVER throws into the app and never blocks a user flow:
 *   every public method catches internally.
 *
 * Downloaded != Applied: `update_downloaded` is recorded when the
 * update bundle is staged. `update_applied` is recorded only at a
 * LATER launch whose running update (expo-updates `updateId` /
 * `isEmbeddedLaunch`) matches the staged one — proof the device
 * actually restarted onto the new bundle.
 */
import type { UpdateTelemetryEvent } from '../update/UpdateService';

export type TelemetryEventType =
  | 'update_check'
  | 'update_available'
  | 'update_downloaded'
  | 'update_applied'
  | 'update_failed';

export interface QueuedEvent {
  client_event_id: string;
  event_type: TelemetryEventType;
  update_id: string | null;
  status: 'ok' | 'failed';
  failure_reason: string | null;
  client_ts: string;
}

export interface InstallationFacts {
  platform: string;
  os_version: string | null;
  app_version: string | null;
  version_code: number | null;
  runtime_version: string | null;
  channel: string | null;
  current_update_id: string | null;
  is_embedded_launch: boolean;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface TelemetryDeps {
  secureStore: KeyValueStore;
  fallbackStore: KeyValueStore;
  post: (url: string, headers: Record<string, string>, body: unknown) => Promise<boolean>;
  endpoint: string | null;
  publishableKey: string | null;
  facts: () => InstallationFacts;
  now: () => Date;
}

const ID_KEY = 'basera.install.id';
const SECRET_KEY = 'basera.install.secret';
const QUEUE_KEY = 'basera.telemetry.queue.v1';
const STATE_KEY = 'basera.telemetry.state.v1';
const QUEUE_CAP = 200;

interface TelemetryState {
  lastRunningKey: string | null;
  pendingUpdateId: string | null;
}

export function uuidv4(random: () => number = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function randomSecret(): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += uuidv4().replace(/-/g, '');
  return out;
}

export class Telemetry {
  private deps: TelemetryDeps;
  private store: KeyValueStore | null = null;
  private identity: { id: string; secret: string } | null = null;
  private queue: QueuedEvent[] = [];
  private state: TelemetryState = { lastRunningKey: null, pendingUpdateId: null };
  private initialized = false;
  private flushing = false;

  constructor(deps: TelemetryDeps) {
    this.deps = deps;
  }

  private async kv(): Promise<KeyValueStore> {
    if (this.store) return this.store;
    try {
      await this.deps.secureStore.get(ID_KEY);
      this.store = this.deps.secureStore;
    } catch {
      this.store = this.deps.fallbackStore;
    }
    return this.store;
  }

  /** Load or create the installation identity. Idempotent: the ID is
   *  generated exactly once and reused on every later launch. */
  async ensureIdentity(): Promise<{ id: string; secret: string }> {
    if (this.identity) return this.identity;
    const kv = await this.kv();
    let id = await kv.get(ID_KEY);
    let secret = await kv.get(SECRET_KEY);
    if (!id || !secret) {
      id = uuidv4();
      secret = randomSecret();
      await kv.set(ID_KEY, id);
      await kv.set(SECRET_KEY, secret);
    }
    this.identity = { id, secret };
    return this.identity;
  }

  private async loadPersisted(): Promise<void> {
    const kv = await this.kv();
    try {
      const q = await kv.get(QUEUE_KEY);
      this.queue = q ? (JSON.parse(q) as QueuedEvent[]) : [];
    } catch {
      this.queue = [];
    }
    try {
      const s = await kv.get(STATE_KEY);
      if (s) this.state = JSON.parse(s) as TelemetryState;
    } catch {
      /* keep defaults */
    }
  }

  private async persistQueue(): Promise<void> {
    const kv = await this.kv();
    await kv.set(QUEUE_KEY, JSON.stringify(this.queue.slice(-QUEUE_CAP)));
  }

  private async persistState(): Promise<void> {
    const kv = await this.kv();
    await kv.set(STATE_KEY, JSON.stringify(this.state));
  }

  private enqueue(e: Omit<QueuedEvent, 'client_event_id' | 'client_ts'>): void {
    this.queue.push({
      ...e,
      client_event_id: uuidv4(),
      client_ts: this.deps.now().toISOString(),
    });
    if (this.queue.length > QUEUE_CAP) this.queue = this.queue.slice(-QUEUE_CAP);
    void this.persistQueue().catch(() => undefined);
  }

  private runningKey(): string {
    const f = this.deps.facts();
    return f.is_embedded_launch ? 'embedded' : (f.current_update_id ?? 'embedded');
  }

  /**
   * Launch observation: register/heartbeat happens through flush();
   * here we detect whether a previously downloaded update is now the
   * RUNNING one (update_applied), and persist the new running key.
   */
  async observeLaunch(): Promise<void> {
    const running = this.runningKey();
    const pending = this.state.pendingUpdateId;
    if (pending && (running === pending || (pending === 'rollback-to-embedded' && running === 'embedded'))) {
      this.enqueue({
        event_type: 'update_applied',
        update_id: pending,
        status: 'ok',
        failure_reason: null,
      });
      this.state.pendingUpdateId = null;
    } else if (this.state.lastRunningKey && this.state.lastRunningKey !== running) {
      // The running bundle changed without our download path (native
      // recovery, server rollback applied at the native layer, ...).
      this.enqueue({
        event_type: 'update_applied',
        update_id: running === 'embedded' ? 'rollback-to-embedded' : running,
        status: 'ok',
        failure_reason: null,
      });
      this.state.pendingUpdateId = null;
    }
    this.state.lastRunningKey = running;
    await this.persistState().catch(() => undefined);
  }

  /** Sink for UpdateService lifecycle events. */
  handleUpdateEvent(e: UpdateTelemetryEvent): void {
    try {
      switch (e.type) {
        case 'update_check':
          this.enqueue({ event_type: 'update_check', update_id: null, status: 'ok', failure_reason: null });
          break;
        case 'update_available':
          this.enqueue({ event_type: 'update_available', update_id: e.updateId, status: 'ok', failure_reason: null });
          break;
        case 'update_downloaded':
          this.enqueue({ event_type: 'update_downloaded', update_id: e.updateId, status: 'ok', failure_reason: null });
          this.state.pendingUpdateId = e.updateId;
          void this.persistState().catch(() => undefined);
          break;
        case 'update_failed':
          this.enqueue({
            event_type: 'update_failed',
            update_id: e.updateId,
            status: 'failed',
            failure_reason: (e.reason ?? 'unknown').slice(0, 300),
          });
          break;
      }
      void this.flush().catch(() => undefined);
    } catch {
      /* telemetry never breaks the app */
    }
  }

  /**
   * Send queued events + the installation heartbeat. Every flush
   * carries the current installation facts, so the same call is the
   * first-launch registration and every later launch's last-seen
   * update. Returns true when the server accepted the batch.
   */
  async flush(): Promise<boolean> {
    if (this.flushing || !this.deps.endpoint || !this.deps.publishableKey) return false;
    this.flushing = true;
    try {
      const identity = await this.ensureIdentity();
      const batch = this.queue.slice(0, 50);
      const ok = await this.deps.post(
        this.deps.endpoint,
        {
          'content-type': 'application/json',
          apikey: this.deps.publishableKey,
          authorization: `Bearer ${this.deps.publishableKey}`,
          'x-installation-id': identity.id,
          'x-installation-secret': identity.secret,
        },
        { installation: this.deps.facts(), events: batch },
      );
      if (ok) {
        this.queue = this.queue.slice(batch.length);
        await this.persistQueue().catch(() => undefined);
      }
      return ok;
    } catch {
      return false;
    } finally {
      this.flushing = false;
    }
  }

  /** App-start entry: identity, persisted state, launch observation,
   *  and a flush attempt (registration on first launch, heartbeat and
   *  queued-event delivery afterwards). Safe to call once per launch. */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      await this.ensureIdentity();
      await this.loadPersisted();
      await this.observeLaunch();
      await this.flush();
    } catch {
      /* telemetry never breaks the app */
    }
  }

  /** Test/diagnostic view of the pending queue length. */
  get queuedCount(): number {
    return this.queue.length;
  }
}
