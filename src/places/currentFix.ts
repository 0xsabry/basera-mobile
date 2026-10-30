/**
 * One-shot current-location fix for Place Memory (save / find / near).
 * Foreground permission only. Errors are typed so callers can be honest:
 * 'permission' (denied — explain + settings recovery) vs 'unavailable'
 * (GPS off / no fix). A fix is NEVER fabricated.
 */
export interface GeoFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  at: number;
}

export type FixError = 'permission' | 'unavailable';

export interface FixResult {
  fix: GeoFix | null;
  error: FixError | null;
}

interface LocationModuleLike {
  requestForegroundPermissionsAsync(): Promise<{ granted: boolean }>;
  getForegroundPermissionsAsync(): Promise<{ granted: boolean }>;
  getCurrentPositionAsync(options: { accuracy: number }): Promise<{
    coords: { latitude: number; longitude: number; accuracy: number | null };
    timestamp: number;
  }>;
  Accuracy: { Balanced: number };
}

function loadLocation(): LocationModuleLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-location') as LocationModuleLike;
}

/** Request permission if needed, then take a fix. */
export async function getCurrentFix(requestIfNeeded = true): Promise<FixResult> {
  try {
    const Location = loadLocation();
    let granted = (await Location.getForegroundPermissionsAsync()).granted;
    if (!granted && requestIfNeeded) {
      granted = (await Location.requestForegroundPermissionsAsync()).granted;
    }
    if (!granted) return { fix: null, error: 'permission' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      fix: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyM: pos.coords.accuracy ?? null,
        at: pos.timestamp,
      },
      error: null,
    };
  } catch {
    return { fix: null, error: 'unavailable' };
  }
}

/** Take a fix ONLY if permission is already granted (never prompts). */
export async function getFixIfPermitted(): Promise<FixResult> {
  return getCurrentFix(false);
}
