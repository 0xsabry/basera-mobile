/**
 * OTA update service (V1.1 Phase 0) — wraps expo-updates.
 *
 * SINGLE authoritative flow (OTA lifecycle audit, docs/OTA_AUDIT.md):
 * this service owns every normal check / download / apply decision.
 * The native layer's own auto-check is set to ON_ERROR_RECOVERY
 * (app.json updates.checkAutomatically), which never checks on a normal
 * launch — it can only fetch a recovery update after repeated crashes,
 * so it cannot race or duplicate this flow.
 *
 * Safety contract (owner-approved):
 * - Checks and downloads NEVER reload the app.
 * - A downloaded update applies only on a natural cold start, or when the
 *   user explicitly presses "Restart to apply" AND no accessibility
 *   operation is busy (speech, recognition, processing, hazard handling)
 *   AND no check/download is in flight.
 * - Overlapping checkAndDownload() calls share ONE in-flight promise:
 *   the native check/fetch pair runs at most once at a time.
 * - In Expo Go / the dev client / the 1.0.0 MVP build (no expo-updates
 *   native module), the service reports `unavailable` honestly instead of
 *   pretending updates work.
 *
 * The native module is lazy-required and injectable so unit tests run
 * against a fake (jest maps every `expo-*` import to a shared stub).
 */
import { isAccessibilityBusy } from '../state/accessibilityBusy';

export interface UpdatesNativeModule {
  isEnabled: boolean;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  isEmbeddedLaunch: boolean;
  checkForUpdateAsync: () => Promise<{ isUpdateAvailable: boolean; manifest?: { id?: string } }>;
  fetchUpdateAsync: () => Promise<{ isNew: boolean; manifest?: { id?: string } }>;
  reloadAsync: () => Promise<void>;
}

export type UpdatePhase =
  | 'idle' // no check yet, or checked and up to date
  | 'checking'
  | 'downloading'
  | 'ready' // downloaded; applies on restart / safe manual restart
  | 'error'
  | 'unavailable'; // expo-updates not present in this build

export interface UpdateStatus {
  available: boolean;
  channel: string | null;
  runtimeVersion: string | null;
  currentUpdateId: string | null;
  isEmbeddedLaunch: boolean;
  lastCheckAt: string | null;
  phase: UpdatePhase;
  pendingUpdateId: string | null;
  error: string | null;
}

export type RestartResult =
  | { applied: true }
  | { applied: false; reason: 'unavailable' | 'no-update' | 'busy' | 'in-progress' };

function loadNativeModule(): UpdatesNativeModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-updates') as UpdatesNativeModule;
    if (!mod || typeof mod.checkForUpdateAsync !== 'function') return null;
    return mod;
  } catch {
    return null;
  }
}

export class UpdateService {
  private native: UpdatesNativeModule | null;
  private busyGuard: () => boolean;
  private phase: UpdatePhase;
  /** The single in-flight check/download, shared by overlapping callers. */
  private inFlight: Promise<UpdateStatus> | null = null;
  private lastCheckAt: string | null = null;
  private pendingUpdateId: string | null = null;
  private error: string | null = null;
  private listeners = new Set<() => void>();

  constructor(native?: UpdatesNativeModule | null, busyGuard: () => boolean = isAccessibilityBusy) {
    this.native = native === undefined ? loadNativeModule() : native;
    this.busyGuard = busyGuard;
    this.phase = !this.native || !this.native.isEnabled ? 'unavailable' : 'idle';
  }

  get isAvailable(): boolean {
    return !!this.native && this.native.isEnabled;
  }

  getStatus(): UpdateStatus {
    const n = this.native;
    return {
      available: this.isAvailable,
      channel: n?.channel ?? null,
      runtimeVersion: n?.runtimeVersion ?? null,
      currentUpdateId: n?.updateId ?? null,
      isEmbeddedLaunch: n?.isEmbeddedLaunch ?? true,
      lastCheckAt: this.lastCheckAt,
      phase: this.phase,
      pendingUpdateId: this.pendingUpdateId,
      error: this.error,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setPhase(phase: UpdatePhase): void {
    this.phase = phase;
    for (const l of this.listeners) l();
  }

  /** True while a check/download run is in flight. */
  get isCheckInFlight(): boolean {
    return this.inFlight !== null;
  }

  /**
   * Check for a compatible update and, if one exists, download it.
   * NEVER reloads. The downloaded bundle becomes active on the next cold
   * start automatically (expo-updates semantics), or immediately only via
   * restartToApply().
   *
   * Concurrency: overlapping calls return the SAME in-flight promise, so
   * the native checkForUpdateAsync/fetchUpdateAsync pair is never invoked
   * twice concurrently and no duplicate requests are issued.
   */
  async checkAndDownload(): Promise<UpdateStatus> {
    if (this.inFlight) return this.inFlight;
    const run = this.runCheckAndDownload();
    this.inFlight = run;
    try {
      return await run;
    } finally {
      if (this.inFlight === run) this.inFlight = null;
    }
  }

  private async runCheckAndDownload(): Promise<UpdateStatus> {
    if (!this.native || !this.native.isEnabled) {
      this.setPhase('unavailable');
      return this.getStatus();
    }
    this.error = null;
    this.setPhase('checking');
    try {
      const check = await this.native.checkForUpdateAsync();
      this.lastCheckAt = new Date().toISOString();
      if (!check.isUpdateAvailable) {
        this.setPhase(this.pendingUpdateId ? 'ready' : 'idle');
        return this.getStatus();
      }
      this.setPhase('downloading');
      const fetched = await this.native.fetchUpdateAsync();
      if (fetched.isNew) {
        this.pendingUpdateId = fetched.manifest?.id ?? check.manifest?.id ?? 'downloaded';
        this.setPhase('ready');
      } else {
        this.setPhase('idle');
      }
      return this.getStatus();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'update check failed';
      this.setPhase('error');
      return this.getStatus();
    }
  }

  /**
   * The ONLY reload path in the app. Refuses while an accessibility
   * operation is busy, while a check/download is in flight, and when
   * nothing was downloaded.
   */
  async restartToApply(): Promise<RestartResult> {
    if (!this.native || !this.native.isEnabled) return { applied: false, reason: 'unavailable' };
    if (this.inFlight) return { applied: false, reason: 'in-progress' };
    if (!this.pendingUpdateId) return { applied: false, reason: 'no-update' };
    if (this.busyGuard()) return { applied: false, reason: 'busy' };
    await this.native.reloadAsync();
    return { applied: true };
  }
}

/** App-wide singleton (lazy native load happens on first construction). */
export const updateService = new UpdateService();
