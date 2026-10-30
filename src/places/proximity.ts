/**
 * Foreground proximity announcer. The pure checker + storage live in
 * proximityCore.ts (headless-safe, shared with the background task);
 * this module adds SPEECH, which is only guaranteed in the foreground.
 * Runs only when the app is active and a fresh fix exists; never
 * prompts for permission by itself.
 */
import type { AppLanguage } from '../ai/types';
import { speechService } from '../ai/SpeechService';
import { t } from '../i18n/strings';
import { getFixIfPermitted, type GeoFix } from './currentFix';
import { placesStore, type Place } from './PlacesStore';
import {
  checkProximity,
  markProximityNotified,
  readProximityNotified,
} from './proximityCore';

export {
  PROXIMITY_COOLDOWN_MS,
  checkProximity,
  drainPendingProximityEvents,
  recordPendingProximityEvent,
  type PendingProximityEvent,
  type ProximityHit,
} from './proximityCore';

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
    lastNotifiedAt: await readProximityNotified(),
    now,
  });
  if (hits.length === 0) return [];
  await markProximityNotified(
    hits.map((h) => h.place.id),
    now,
  );
  for (const hit of hits) {
    const note = hit.place.note ? `. ${hit.place.note}` : '';
    void speechService.speakAnnouncement(`${t(lang, 'placesVoiceNear')}: ${hit.place.name}${note}`, lang);
  }
  return hits.map((h) => h.place);
}
