/**
 * Foreground location sharing (V1.1 Phase 1).
 *
 * Scope honesty:
 * - This is the PHONE's location, not the glasses'.
 * - Sharing runs ONLY while the app is in the foreground and sharing is
 *   enabled in settings. Background tracking is Phase 2 and is NOT
 *   implemented here (no background permission is ever requested).
 * - Battery-conscious: Balanced accuracy, ~30 s / ~25 m between fixes.
 * - Toggling sharing off stops the watcher immediately and asks the server
 *   to purge stored locations (set_sharing_enabled(false)).
 */
import type { GuardianService, LocationPointInput } from './GuardianService';

export type { LocationPointInput };

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
  private running = false;
  private batcher = new LocationBatcher();
  lastError: string | null = null;

  constructor(
    private guardian: GuardianService,
    private adapter: LocationAdapter = new ExpoLocationAdapter(),
    private appState: AppStateLike | null = loadAppState(),
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Begin foreground sharing. Requests FOREGROUND permission only —
   * Phase 1 never asks for background location.
   */
  async start(): Promise<SharingStartResult> {
    if (this.running) return 'started';
    const granted = await this.adapter.requestForegroundPermission();
    if (!granted) return 'permission-denied';
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
   * Full stop: cease uploads immediately AND purge stored locations
   * server-side via set_sharing_enabled(false).
   */
  async disableSharing(): Promise<void> {
    await this.stopWatching();
    this.batcher.flush(); // discard anything unsent
    await this.guardian.setSharingEnabled(false);
  }
}
