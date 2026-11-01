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
 * - A server rollback directive (check result with
 *   `isRollBackToEmbedded: true`) is staged through fetchUpdateAsync
 *   like any other update and applies through the same guarded paths —
 *   it is the server's emergency brake for a bad OTA and must never be
 *   silently dropped.
 * - Checks and downloads NEVER reload the app by themselves.
 * - A downloaded update applies (a) automatically at the NEXT cold
 *   start through checkAndApplyOnLaunch() — the launch flow checks,
 *   downloads, and applies in one pass, before any user operation can
 *   be in flight — or (b) when the user explicitly presses "Restart to
 *   apply". Both go through restartToApply(), which refuses while an
 *   accessibility operation is busy (speech, recognition, processing,
 *   hazard handling) or a check/download is in flight.
 * - Overlapping checkAndDownload() calls share ONE in-flight promise:
 *   the native check/fetch pair runs at most once at a time.
 * - In Expo Go / the dev client / the 1.0.0 MVP build (no expo-updates
 *   native module), the service reports `unavailable` honestly instead of
 *   pretending updates work.
 *
 * The native module is lazy-required and injectable so unit tests run
 * against a fake (jest maps every `expo-*` import to a shared stub).
 */
import type * as ExpoUpdatesSdk from 'expo-updates';

import { isAccessibilityBusy } from '../state/accessibilityBusy';

/**
 * Native result shapes — mirrored from expo-updates SDK 58,
 * node_modules/expo-updates/build/Updates.types.d.ts:
 * `UpdateCheckResult` (the Available / NotAvailable / RollBack union)
 * and `UpdateFetchResult` (Success / Failure / RollBackToEmbedded).
 * The manifest is narrowed to the only field this service reads (`id`,
 * present on both manifest kinds in expo-manifests). Field names are
 * the contract: the check result's availability flag is `isAvailable`.
 * The compile-time assertion below fails `tsc` if the installed SDK
 * module ever stops satisfying this facade, so the mirror cannot
 * silently drift from the SDK again.
 */
export type UpdateCheckResult =
  | { isAvailable: true; manifest: { id: string }; isRollBackToEmbedded: false }
  | { isAvailable: false; manifest: undefined; isRollBackToEmbedded: true }
  | {
      isAvailable: false;
      manifest: undefined;
      isRollBackToEmbedded: false;
      reason: ExpoUpdatesSdk.UpdateCheckResultNotAvailableReason;
    };

export type UpdateFetchResult =
  | { isNew: true; manifest: { id: string }; isRollBackToEmbedded: false }
  | { isNew: false; manifest: undefined; isRollBackToEmbedded: false }
  | { isNew: false; manifest: undefined; isRollBackToEmbedded: true };

export interface UpdatesNativeModule {
  isEnabled: boolean;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  isEmbeddedLaunch: boolean;
  /** Creation time of the currently running update (expo-updates
   *  `createdAt`); absent/null on embedded launches and older builds. */
  createdAt?: Date | string | null;
  checkForUpdateAsync: () => Promise<UpdateCheckResult>;
  fetchUpdateAsync: () => Promise<UpdateFetchResult>;
  reloadAsync: () => Promise<void>;
}

type ExpectTrue<T extends true> = T;
/** Tripwire: the real expo-updates module must satisfy the facade. */
export type UpdatesFacadeMatchesSdk = ExpectTrue<
  typeof ExpoUpdatesSdk extends UpdatesNativeModule ? true : false
>;

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
  /** ISO creation time of the running OTA update; null when embedded
   *  or when the native module does not expose it. Display-only: it
   *  describes the running bundle, never the installed version. */
  currentUpdateCreatedAt: string | null;
  isEmbeddedLaunch: boolean;
  lastCheckAt: string | null;
  phase: UpdatePhase;
  pendingUpdateId: string | null;
  error: string | null;
}

export type RestartResult =
  | { applied: true }
  | { applied: false; reason: 'unavailable' | 'no-update' | 'busy' | 'in-progress' | 'failed' };

/**
 * Telemetry seam (installations & OTA adoption tracking): the service
 * reports lifecycle points to an optional sink. The sink is set by the
 * telemetry module at app start; when unset (unit tests, builds
 * without telemetry) the service behaves exactly as before. Events are
 * observational only — the sink can never influence the update flow,
 * and sink exceptions are swallowed here.
 */
export type UpdateTelemetryEvent =
  | { type: 'update_check' }
  | { type: 'update_available'; updateId: string | null }
  | { type: 'update_downloaded'; updateId: string | null }
  | { type: 'update_failed'; updateId: string | null; reason: string };

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
  private telemetrySink: ((e: UpdateTelemetryEvent) => void) | null = null;

  /** Register the telemetry sink (installations & OTA adoption). */
  setTelemetrySink(sink: ((e: UpdateTelemetryEvent) => void) | null): void {
    this.telemetrySink = sink;
  }

  private emitTelemetry(e: UpdateTelemetryEvent): void {
    try {
      this.telemetrySink?.(e);
    } catch {
      // Telemetry is observational; it must never break the update flow.
    }
  }

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
      currentUpdateCreatedAt:
        n?.createdAt instanceof Date
          ? n.createdAt.toISOString()
          : typeof n?.createdAt === 'string'
            ? n.createdAt
            : null,
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
      this.emitTelemetry({ type: 'update_check' });
      if (!check.isAvailable && !check.isRollBackToEmbedded) {
        this.setPhase(this.pendingUpdateId ? 'ready' : 'idle');
        return this.getStatus();
      }
      // An update is available, OR the server sent a rollback-to-
      // embedded directive: both are staged through fetchUpdateAsync.
      this.emitTelemetry({
        type: 'update_available',
        updateId: check.isRollBackToEmbedded ? 'rollback-to-embedded' : (check.manifest?.id ?? null),
      });
      this.setPhase('downloading');
      const fetched = await this.native.fetchUpdateAsync();
      if (fetched.isRollBackToEmbedded) {
        // The embedded bundle is now the staged update; it becomes
        // active through the guarded restart / next cold start.
        this.pendingUpdateId = 'rollback-to-embedded';
        this.setPhase('ready');
        this.emitTelemetry({ type: 'update_downloaded', updateId: 'rollback-to-embedded' });
      } else if (fetched.isNew) {
        this.pendingUpdateId = fetched.manifest?.id ?? check.manifest?.id ?? 'downloaded';
        this.setPhase('ready');
        this.emitTelemetry({ type: 'update_downloaded', updateId: this.pendingUpdateId });
      } else {
        this.emitTelemetry({
          type: 'update_failed',
          updateId: check.manifest?.id ?? null,
          reason: 'fetch-returned-no-update',
        });
        this.setPhase('idle');
      }
      return this.getStatus();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'update check failed';
      this.emitTelemetry({ type: 'update_failed', updateId: null, reason: this.error });
      this.setPhase('error');
      return this.getStatus();
    }
  }

  /**
   * The ONLY reload path in the app. Refuses while an accessibility
   * operation is busy, while a check/download is in flight, and when
   * nothing was downloaded. A native reload failure is surfaced
   * honestly (phase 'error' + the real message), never swallowed.
   */
  async restartToApply(): Promise<RestartResult> {
    if (!this.native || !this.native.isEnabled) return { applied: false, reason: 'unavailable' };
    if (this.inFlight) return { applied: false, reason: 'in-progress' };
    if (!this.pendingUpdateId) return { applied: false, reason: 'no-update' };
    if (this.busyGuard()) return { applied: false, reason: 'busy' };
    try {
      await this.native.reloadAsync();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'update apply failed';
      this.setPhase('error');
      return { applied: false, reason: 'failed' };
    }
    return { applied: true };
  }

  /** Set once this process has consumed its cold-start apply attempt,
   *  so a remount can never double-apply (reload restarts the process
   *  anyway; this is belt-and-braces against effect re-runs). */
  private launchApplyConsumed = false;

  /**
   * Cold-start update flow (owner order 2026-11-01 — update delivery
   * must need ZERO user steps): check + download, and if an update is
   * staged afterwards, apply it immediately through the same guarded
   * restartToApply() path. Launch is the safe moment — no speech,
   * camera, OCR or hazard operation can be in flight before the user
   * has done anything — and the busy guard is still honored if one
   * somehow is. When nothing is staged this is a plain check. Apply
   * happens at most once per process; a failure lands in the status
   * (phase 'error' + real reason) for the Updates screen to show.
   */
  async checkAndApplyOnLaunch(): Promise<RestartResult> {
    if (this.launchApplyConsumed) return { applied: false, reason: 'no-update' };
    this.launchApplyConsumed = true;
    const status = await this.checkAndDownload();
    if (status.phase !== 'ready') return { applied: false, reason: 'no-update' };
    return this.restartToApply();
  }
}

/** App-wide singleton (lazy native load happens on first construction). */
export const updateService = new UpdateService();
