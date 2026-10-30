/**
 * Proximity awareness for saved places.
 *
 * - `checkProximity` is PURE: given a fix + places + last-notified map
 *   it returns the places newly within radius (cooldown applied). The
 *   background location task (area 6) imports it too — but background
 *   code must only RECORD pending events (no TTS guarantee headless);
 *   speech happens in the foreground announcer below.
 * - Cooldown: 30 minutes per place, persisted in AsyncStorage.
 * - The foreground announcer runs only when the app is active and a
 *   fresh fix exists (never prompts for permission by itself).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppLanguage } from '../ai/types';
import { speechService } from '../ai/SpeechService';
import { t } from '../i18n/strings';
import { getFixIfPermitted, type GeoFix } from './currentFix';
import { placesStore, type Place } from './PlacesStore';
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

async function readNotified(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFIED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function markNotified(ids: string[], now: number): Promise<void> {
  const map = await readNotified();
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

/**
 * Foreground proximity check with speech. Returns the places announced.
 * Never prompts for permission; silently does nothing without a fix.
 */
export async function announceNearbyPlaces(
  lang: AppLanguage,
  radiusM: number,
  deps: {
    getFix?: () => Promise<{ fix: GeoFix | null }>;
    listPlaces?: () => Promise<Place[]>;
    now?: number;
  } = {},
): Promise<Place[]> {
  const getFix = deps.getFix ?? getFixIfPermitted;
  const { fix } = await getFix();
  if (!fix) return [];
  const places = deps.listPlaces ? await deps.listPlaces() : await placesStore.list();
  const now = deps.now ?? Date.now();
  const hits = checkProximity(fix, places, {
    radiusM,
    lastNotifiedAt: await readNotified(),
    now,
  });
  if (hits.length === 0) return [];
  await markNotified(
    hits.map((h) => h.place.id),
    now,
  );
  for (const hit of hits) {
    const note = hit.place.note ? `. ${hit.place.note}` : '';
    void speechService.speakAnnouncement(`${t(lang, 'placesVoiceNear')}: ${hit.place.name}${note}`, lang);
  }
  return hits.map((h) => h.place);
}
