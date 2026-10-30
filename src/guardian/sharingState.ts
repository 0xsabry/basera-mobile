/**
 * Sharing state derivation — PURE. The Family screen feeds it real
 * signals (permission reads, hasStartedLocationUpdatesAsync, offline
 * queue length, services-enabled, last confirmed upload) and displays
 * exactly the state they imply. "Live" is never claimed for stale data.
 *
 * Precedence (first match wins):
 *   off → gps-unavailable → permission-denied → offline-queueing
 *   (background running but points waiting) → background-active →
 *   sync-pending (foreground on, no confirmed upload yet) →
 *   foreground-only.
 */
export type SharingState =
  | 'off'
  | 'foreground-only'
  | 'background-active'
  | 'permission-denied'
  | 'gps-unavailable'
  | 'offline-queueing'
  | 'sync-pending';

export interface SharingSignals {
  /** The user's sharing consent (settings). */
  sharingOn: boolean;
  /** Location services enabled on the device (hasServicesEnabledAsync); null = unknown yet. */
  servicesEnabled: boolean | null;
  /** Foreground permission granted; null = not read yet. */
  foregroundGranted: boolean | null;
  /** Background task actually started (hasStartedLocationUpdatesAsync). */
  backgroundStarted: boolean;
  /** Points waiting in the offline queue. */
  offlineQueueLength: number;
  /** Guardian backend configured at all. */
  configured: boolean;
  /** Last upload the server round-trip confirmed; null = never. */
  lastUploadAt: number | null;
}

export function deriveSharingState(s: SharingSignals): SharingState {
  if (!s.sharingOn) return 'off';
  if (s.servicesEnabled === false) return 'gps-unavailable';
  if (s.foregroundGranted === false) return 'permission-denied';
  if (s.backgroundStarted && s.offlineQueueLength > 0) return 'offline-queueing';
  if (s.backgroundStarted) return 'background-active';
  if (s.configured && s.lastUploadAt === null) return 'sync-pending';
  return 'foreground-only';
}
