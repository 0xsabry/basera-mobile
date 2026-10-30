/**
 * Background location updates (V1.1 Phase 2) over expo-location SDK 58
 * + expo-task-manager — APIs verified against the installed packages:
 *   Location.startLocationUpdatesAsync(taskName, LocationTaskOptions)
 *   Location.stopLocationUpdatesAsync / hasStartedLocationUpdatesAsync
 *   Location.requestBackgroundPermissionsAsync (the "always" prompt)
 * LocationTaskOptions used here (all present in 58.0.20 types):
 *   accuracy (Balanced), timeInterval 60 s, distanceInterval 50 m,
 *   deferredUpdatesDistance 500 m + deferredUpdatesTimeout 5 min
 *   (battery), foregroundService { notificationTitle, notificationBody }.
 *
 * Runtime verdict (built 1.1.0 APK): the merged Android manifest
 * ALREADY declares expo.modules.location.services.LocationTaskService
 * (foregroundServiceType="location") plus BACKGROUND_LOCATION and
 * FOREGROUND_SERVICE(+_LOCATION) permissions, and the foreground
 * service notification is a RUNTIME parameter — so background updates
 * are JS-only on runtime 1.1.0; no new APK is required for this module.
 * (On-device execution remains to be verified by the team.)
 *
 * Consent model: background updates run only while the user enabled
 * background sharing in the Family screen (a separate, explained
 * opt-in on top of ordinary sharing) AND the OS background permission
 * is granted. Disabling sharing stops background updates immediately.
 */
import type { AppLanguage } from '../ai/types';
import { t } from '../i18n/strings';

export const BACKGROUND_LOCATION_TASK = 'basera-background-location';

export interface BackgroundLocationOptions {
  accuracy: number;
  timeInterval: number;
  distanceInterval: number;
  deferredUpdatesDistance: number;
  deferredUpdatesTimeout: number;
  foregroundService: { notificationTitle: string; notificationBody: string };
}

export interface BackgroundLocationAdapter {
  requestBackgroundPermission(): Promise<boolean>;
  getBackgroundPermission(): Promise<boolean>;
  getForegroundPermission(): Promise<boolean>;
  servicesEnabled(): Promise<boolean>;
  start(taskName: string, options: BackgroundLocationOptions): Promise<void>;
  stop(taskName: string): Promise<void>;
  hasStarted(taskName: string): Promise<boolean>;
  balancedAccuracy(): number;
}

interface LocationModuleLike {
  Accuracy: { Balanced: number };
  requestBackgroundPermissionsAsync(): Promise<{ granted: boolean }>;
  getBackgroundPermissionsAsync(): Promise<{ granted: boolean }>;
  getForegroundPermissionsAsync(): Promise<{ granted: boolean }>;
  hasServicesEnabledAsync(): Promise<boolean>;
  startLocationUpdatesAsync(taskName: string, options: BackgroundLocationOptions): Promise<void>;
  stopLocationUpdatesAsync(taskName: string): Promise<void>;
  hasStartedLocationUpdatesAsync(taskName: string): Promise<boolean>;
}

function loadLocation(): LocationModuleLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-location') as LocationModuleLike;
}

export class ExpoBackgroundLocationAdapter implements BackgroundLocationAdapter {
  async requestBackgroundPermission(): Promise<boolean> {
    return (await loadLocation().requestBackgroundPermissionsAsync()).granted;
  }
  async getBackgroundPermission(): Promise<boolean> {
    return (await loadLocation().getBackgroundPermissionsAsync()).granted;
  }
  async getForegroundPermission(): Promise<boolean> {
    return (await loadLocation().getForegroundPermissionsAsync()).granted;
  }
  async servicesEnabled(): Promise<boolean> {
    return loadLocation().hasServicesEnabledAsync();
  }
  async start(taskName: string, options: BackgroundLocationOptions): Promise<void> {
    await loadLocation().startLocationUpdatesAsync(taskName, options);
  }
  async stop(taskName: string): Promise<void> {
    await loadLocation().stopLocationUpdatesAsync(taskName);
  }
  async hasStarted(taskName: string): Promise<boolean> {
    return loadLocation().hasStartedLocationUpdatesAsync(taskName);
  }
  balancedAccuracy(): number {
    return loadLocation().Accuracy.Balanced;
  }
}

/** The exact options handed to startLocationUpdatesAsync (tested). */
export function buildBackgroundOptions(
  lang: AppLanguage,
  balancedAccuracy: number,
): BackgroundLocationOptions {
  return {
    accuracy: balancedAccuracy,
    timeInterval: 60_000,
    distanceInterval: 50,
    deferredUpdatesDistance: 500,
    deferredUpdatesTimeout: 5 * 60_000,
    foregroundService: {
      notificationTitle: `${t(lang, 'appName')} — ${t(lang, 'bgNotificationTitle')}`,
      notificationBody: t(lang, 'bgNotificationBody'),
    },
  };
}

export type BackgroundStartResult = 'started' | 'permission-denied' | 'already-started';

export class BackgroundLocationService {
  constructor(private adapter: BackgroundLocationAdapter = new ExpoBackgroundLocationAdapter()) {}

  /**
   * The dedicated background-permission flow. The Family screen shows
   * the explanation BEFORE calling this; the OS "Allow all the time"
   * prompt is what the user answers here.
   */
  async requestBackgroundPermission(): Promise<boolean> {
    return this.adapter.requestBackgroundPermission();
  }

  async startBackgroundUpdates(lang: AppLanguage): Promise<BackgroundStartResult> {
    if (await this.adapter.hasStarted(BACKGROUND_LOCATION_TASK)) return 'already-started';
    const granted = await this.adapter.getBackgroundPermission();
    if (!granted) return 'permission-denied';
    await this.adapter.start(
      BACKGROUND_LOCATION_TASK,
      buildBackgroundOptions(lang, this.adapter.balancedAccuracy()),
    );
    return 'started';
  }

  async stopBackgroundUpdates(): Promise<void> {
    try {
      if (await this.adapter.hasStarted(BACKGROUND_LOCATION_TASK)) {
        await this.adapter.stop(BACKGROUND_LOCATION_TASK);
      }
    } catch {
      /* stopping must never throw into the disable-sharing flow */
    }
  }

  async hasStarted(): Promise<boolean> {
    try {
      return await this.adapter.hasStarted(BACKGROUND_LOCATION_TASK);
    } catch {
      return false;
    }
  }

  async backgroundGranted(): Promise<boolean> {
    try {
      return await this.adapter.getBackgroundPermission();
    } catch {
      return false;
    }
  }

  async foregroundGranted(): Promise<boolean> {
    try {
      return await this.adapter.getForegroundPermission();
    } catch {
      return false;
    }
  }

  async servicesEnabled(): Promise<boolean> {
    try {
      return await this.adapter.servicesEnabled();
    } catch {
      return false;
    }
  }
}

let shared: BackgroundLocationService | undefined;
export function getBackgroundLocationService(): BackgroundLocationService {
  if (!shared) shared = new BackgroundLocationService();
  return shared;
}
