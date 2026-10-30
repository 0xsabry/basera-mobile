/**
 * Background location task REGISTRATION. This module is imported for
 * its side effect by the root layout: TaskManager.defineTask must run
 * in the app's global scope before the OS can deliver background
 * location batches (including after a headless relaunch).
 *
 * The executor delegates to handleLocationBatch with real deps:
 * uploads go through the Guardian service (supabase-js works in the
 * background JS context; the session adapter is SecureStore-based),
 * failures fall back to the offline queue, and proximity matches are
 * recorded as pending events — never spoken headless.
 */
import * as TaskManager from 'expo-task-manager';
import { BACKGROUND_LOCATION_TASK } from './BackgroundLocationService';
import { getGuardianService, type LocationPointInput } from './GuardianService';
import { offlineLocationQueue } from './OfflineLocationQueue';
import { handleLocationBatch } from './backgroundTaskHandler';
import { getSupabaseClient } from './supabaseClient';
import { recordSuccessfulUpload } from './uploadMeta';
import { placesStore } from '../places/PlacesStore';
import {
  checkProximity,
  markProximityNotified,
  readProximityNotified,
  recordPendingProximityEvent,
} from '../places/proximityCore';

interface LocationTaskData {
  locations?: {
    coords: { latitude: number; longitude: number; accuracy: number | null };
    timestamp: number;
  }[];
}

const DEFAULT_PROXIMITY_RADIUS_M = 150;

async function uploadsAvailable(): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) return false;
  try {
    const { data } = await client.auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

async function proximityHook(newest: LocationPointInput): Promise<void> {
  const places = await placesStore.list();
  if (places.length === 0) return;
  const now = Date.now();
  const hits = checkProximity(
    { lat: newest.lat, lng: newest.lng, accuracyM: newest.accuracyM, at: now },
    places,
    { radiusM: DEFAULT_PROXIMITY_RADIUS_M, lastNotifiedAt: await readProximityNotified(), now },
  );
  for (const hit of hits) {
    await recordPendingProximityEvent({ placeId: hit.place.id, name: hit.place.name, at: now });
  }
  if (hits.length > 0) {
    await markProximityNotified(
      hits.map((h) => h.place.id),
      now,
    );
  }
}

TaskManager.defineTask<LocationTaskData>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const points: LocationPointInput[] = data.locations.map((loc) => ({
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    accuracyM: loc.coords.accuracy ?? null,
    recordedAt: new Date(loc.timestamp).toISOString(),
  }));
  await handleLocationBatch(points, {
    uploadsAvailable,
    upload: (pts) => getGuardianService().uploadLocationPoints(pts),
    enqueueOffline: (pts) => offlineLocationQueue.enqueue(pts),
    recordUploadSuccess: (at) => recordSuccessfulUpload(at),
    proximity: proximityHook,
  });
});
