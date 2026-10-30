/**
 * Headless-safe proximity core: the pure checker, cooldown storage and
 * pending-event recording. NO speech / UI imports — the background
 * location task imports this module, and TTS is not guaranteed in a
 * headless JS context. Foreground speech lives in proximity.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GeoFix } from './currentFix';
import type { Place } from './PlacesStore';
import { haversineMeters } from './placesText';

export const PROXIMITY_COOLDOWN_MS = 30 * 60 * 1000;
const NOTIFIED_KEY = 'basera.placesProximityNotified.v1';
const PENDING_KEY = 'basera.placesProximityPending.v1';

export interface ProximityHit {
  place: Place;
  distanceM: number;
}

export function checkProximity(
  fix: GeoFix,
  places: Place[],
  opts: {
    radiusM: number;
    lastNotifiedAt: Record<string, number>;
    now: number;
    cooldownMs?: number;
  },
): ProximityHit[] {
  const cooldown = opts.cooldownMs ?? PROXIMITY_COOLDOWN_MS;
  return places
    .filter((p) => p.proximityEnabled)
    .map((place) => ({ place, distanceM: haversineMeters(fix, place) }))
    .filter((h) => h.distanceM <= opts.radiusM)
    .filter((h) => {
      // Absent/0 means "never notified" — always eligible.
      const last = opts.lastNotifiedAt[h.place.id];
      return !last || opts.now - last >= cooldown;
    })
    .sort((a, b) => a.distanceM - b.distanceM);
}

export async function readProximityNotified(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFIED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export async function markProximityNotified(ids: string[], now: number): Promise<void> {
  const map = await readProximityNotified();
  for (const id of ids) map[id] = now;
  await AsyncStorage.setItem(NOTIFIED_KEY, JSON.stringify(map));
}

export interface PendingProximityEvent {
  placeId: string;
  name: string;
  at: number;
}

/** Record a proximity event (used by the background task; surfaced later). */
export async function recordPendingProximityEvent(ev: PendingProximityEvent): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const list: PendingProximityEvent[] = raw ? JSON.parse(raw) : [];
    list.push(ev);
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* best-effort */
  }
}

export async function drainPendingProximityEvents(): Promise<PendingProximityEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    await AsyncStorage.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingProximityEvent[]) : [];
  } catch {
    return [];
  }
}
