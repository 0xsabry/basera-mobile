/**
 * Foreground location sharing (V1.1 Phase 1).
 *
 * Scope honesty:
 * - This is the PHONE's location, not the glasses'.
 * - Sharing runs ONLY while the app is in the foreground and sharing is
 *   enabled in settings. Background tracking is Phase 2 and is NOT
 *   implemented here (no background permission is ever requested).
 * - Battery-conscious: Balanced accuracy, ~30 s / ~25 m between fixes.
 * - Toggling sharing off stops the watcher immediately (local truth) and
 *   records a PERSISTED server-deletion obligation (PendingDeletion):
 *   the purge RPC runs now if possible and retries on app launch /
 *   foreground / screen mount until the server confirms. The UI always
 *   distinguishes "off on this device" from "server copies deleted —
 *   confirmed"; the latter is claimed only after RPC success.
 */
import {
  getGuardianService,
  type GuardianService,
  type LocationPointInput,
} from './GuardianService';
import {
  PendingDeletionManager,
  type DeletionStatus,
  type PendingDeletionReason,
} from './PendingDeletion';

export type { LocationPointInput };
export type { DeletionStatus, PendingDeletionReason };

/** Batches points: flush at >= maxPoints points or >= maxWaitMs elapsed. */
export class LocationBatcher {
  private points: LocationPointInput[] = [];
  private firstAt: number | null = null;

  constructor(
    private maxPoints = 3,
    private maxWaitMs = 60_000,
    private now: () => number = () => Date.now(),
  ) {}

  /** @returns true when the batch should be flushed now. */
  add(point: LocationPointInput): boolean {
    if (this.points.length === 0) this.firstAt = this.now();
    this.points.push(point);
    return this.shouldFlush();
  }

  shouldFlush(): boolean {
    if (this.points.length === 0) return false;
    if (this.points.length >= this.maxPoints) return true;
    return this.firstAt !== null && this.now() - this.firstAt >= this.maxWaitMs;
  }

  flush(): LocationPointInput[] {
    const out = this.points;
    this.points = [];
    this.firstAt = null;
    return out;
  }

  get size(): number {
    return this.points.length;
  }
}

export interface LocationSubscriptionLike {
  remove(): void;
}

export interface LocationAdapter {
  requestForegroundPermission(): Promise<boolean>;
  watchPosition(
    onPoint: (point: LocationPointInput) => void,
    onError: (message: string) => void,
  ): Promise<LocationSubscriptionLike>;
}

/** Real adapter over expo-location (lazy require; verified SDK 58 API:
 *  requestForegroundPermissionsAsync + watchPositionAsync with
 *  LocationAccuracy.Balanced). */
export class ExpoLocationAdapter implements LocationAdapter {
  async requestForegroundPermission(): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Location = require('expo-location');
    const res = await Location.requestForegroundPermissionsAsync();
    return !!res.granted;
  }

  async watchPosition(
    onPoint: (point: LocationPointInput) => void,
    onError: (message: string) => void,
  ): Promise<LocationSubscriptionLike> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Location = require('expo-location');
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 30_000,
        distanceInterval: 25,
      },
      (loc: {
        coords: { latitude: number; longitude: number; accuracy: number | null };
        timestamp: number;
      }) => {
        onPoint({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracyM: loc.coords.accuracy ?? null,
          recordedAt: new Date(loc.timestamp).toISOString(),
        });
      },
      (err: { message?: string }) => onError(err?.message ?? 'location error'),
    );
    return { remove: () => sub.remove() };
  }
}

interface AppStateLike {
  addEventListener: (
    type: 'change',
    listener: (state: string) => void,
  ) => { remove(): void };
  currentState: string | null;
}

function loadAppState(): AppStateLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native');
    return (AppState as AppStateLike) ?? null;
  } catch {
    return null;
  }
}

export type SharingStartResult = 'started' | 'permission-denied';

export class LocationSharingService {
  private subscription: LocationSubscriptionLike | null = null;
  private appStateSub: { remove(): void } | null = null;
  private deletionAppStateSub: { remove(): void } | null = null;
  private running = false;
  private batcher = new LocationBatcher();
  private deletion: PendingDeletionManager;
  lastError: string | null = null;

  constructor(
    private guardian: GuardianService,
    private adapter: LocationAdapter = new ExpoLocationAdapter(),
    private appState: AppStateLike | null = loadAppState(),
    deletionManager?: PendingDeletionManager,
  ) {
    this.deletion = deletionManager ?? new PendingDeletionManager(guardian);
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ----- Server-deletion state (PendingDeletion state machine) -----

  get deletionStatus(): DeletionStatus {
    return this.deletion.getStatus();
  }

  subscribeDeletionStatus(listener: () => void): () => void {
    return this.deletion.subscribe(listener);
  }

  /**
   * Module-init / mount hook: reload any persisted deletion obligation,
   * retry it, and (once) arm the AppState-foreground retry trigger.
   * Retries are app-activity-driven by design — no netinfo, no
   * background jobs, no new native dependencies.
   */
  async initDeletion(): Promise<void> {
    await this.deletion.init().catch(() => undefined);
    if (this.appState && !this.deletionAppStateSub) {
      this.deletionAppStateSub = this.appState.addEventListener('change', (state) => {
        if (state === 'active') void this.deletion.attemptDeletion();
      });
    }
  }

  /** Explicit retry (guardian screen "Retry now" button). */
  async retryPendingDeletion(): Promise<DeletionStatus> {
    return this.deletion.attemptDeletion();
  }

  /**
   * Record a server-deletion obligation (persisted first, attempted
   * immediately, retried until confirmed). Used when the last guardian
   * is revoked; disableSharing uses the same path internally.
   */
  async requestServerDeletion(
    reason: PendingDeletionReason,
    linkId: string | null = null,
  ): Promise<DeletionStatus> {
    return this.deletion.requestDeletion(reason, linkId);
  }

  /**
   * Begin foreground sharing. Requests FOREGROUND permission only —
   * Phase 1 never asks for background location.
   */
  async start(): Promise<SharingStartResult> {
    if (this.running) return 'started';
    const granted = await this.adapter.requestForegroundPermission();
    if (!granted) return 'permission-denied';
    // A pending deletion is NEVER dropped by re-enabling sharing: it is
    // attempted first on this contact, and if it still fails it stays
    // queued (its purge deletes points stored up to the moment it runs).
    await this.deletion.init().catch(() => undefined);
    await this.guardian.setSharingEnabled(true);
    await this.subscribeWatch();
    this.running = true;
    this.watchAppState();
    return 'started';
  }

  private async subscribeWatch(): Promise<void> {
    if (this.subscription) return;
    this.subscription = await this.adapter.watchPosition(
      (point) => {
        if (this.batcher.add(point)) void this.flushBatch();
      },
      (message) => {
        this.lastError = message;
      },
    );
  }

  private unsubscribeWatch(): void {
    this.subscription?.remove();
    this.subscription = null;
  }

  private watchAppState(): void {
    if (!this.appState || this.appStateSub) return;
    this.appStateSub = this.appState.addEventListener('change', (state) => {
      if (!this.running) return;
      if (state === 'background' || state === 'inactive') {
        // Foreground-only guarantee: no fixes are collected off-screen.
        this.unsubscribeWatch();
        void this.flushBatch();
      } else if (state === 'active') {
        void this.subscribeWatch();
      }
    });
  }

  async flushBatch(): Promise<void> {
    if (this.batcher.size === 0) return;
    const points = this.batcher.flush();
    try {
      await this.guardian.uploadLocationPoints(points);
    } catch (e) {
      // Keep the failure visible to diagnostics; points are dropped rather
      // than queued forever (24 h retention makes stale queues pointless).
      this.lastError = e instanceof Error ? e.message : 'upload failed';
    }
  }

  /** Pause collection (e.g. screen unmount) without changing consent. */
  async stopWatching(): Promise<void> {
    this.running = false;
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.unsubscribeWatch();
    await this.flushBatch();
  }

  /**
   * Full stop: cease collection/uploads immediately (local truth, works
   * fully offline) AND record the persisted server-deletion obligation.
   * The purge executes now when the network allows and retries until
   * the server confirms — see PendingDeletion. Network failure no
   * longer throws from here: it becomes deletionStatus 'pending'.
   */
  async disableSharing(): Promise<void> {
    await this.stopWatching();
    this.batcher.flush(); // discard anything unsent
    await this.deletion.requestDeletion('sharing-disabled');
  }
}

let sharedSharingService: LocationSharingService | undefined;

/**
 * App-wide singleton (used by the root layout's launch retry and the
 * guardian screen, so both observe the same deletion state).
 */
export function getLocationSharingService(): LocationSharingService {
  if (!sharedSharingService) {
    sharedSharingService = new LocationSharingService(getGuardianService());
  }
  return sharedSharingService;
}
