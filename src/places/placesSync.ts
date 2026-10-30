/**
 * Optional cloud sync for Smart Place Memory — EXPLICIT OPT-IN only
 * (Settings toggle, default off). Places live on-device; this pushes /
 * pulls the signed-in user's OWN rows from `saved_places` (migration
 * 0004, owner-only RLS — guardians have no access by design).
 *
 * Honest outcomes only: 'unconfigured' when Supabase is not set up,
 * 'signed-out' without a session, 'failed' on any error (local data is
 * untouched), 'synced' only after the server round-trip succeeds.
 */
import { getSupabaseClient } from '../guardian/supabaseClient';
import type { Place, PlaceCategory, PlacesStore } from './PlacesStore';

export type PlacesSyncOutcome = 'synced' | 'unconfigured' | 'signed-out' | 'failed';

interface SavedPlaceRow {
  local_id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  note: string;
  entrance_info: string | null;
  obstacles_note: string | null;
  favorite: boolean;
  proximity_enabled: boolean;
  place_created_at: string;
  last_visited_at: string | null;
  updated_at: string;
}

function toRow(p: Place, userId: string): SavedPlaceRow & { user_id: string } {
  return {
    user_id: userId,
    local_id: p.id,
    name: p.name,
    category: p.category,
    lat: p.lat,
    lng: p.lng,
    accuracy_m: p.accuracyM,
    note: p.note,
    entrance_info: p.entranceInfo ?? null,
    obstacles_note: p.obstaclesNote ?? null,
    favorite: p.favorite,
    proximity_enabled: p.proximityEnabled,
    place_created_at: new Date(p.createdAt).toISOString(),
    last_visited_at: p.lastVisitedAt ? new Date(p.lastVisitedAt).toISOString() : null,
    updated_at: new Date(p.updatedAt).toISOString(),
  };
}

function fromRow(r: SavedPlaceRow): Place {
  return {
    id: r.local_id,
    name: r.name,
    category: r.category as PlaceCategory,
    lat: r.lat,
    lng: r.lng,
    accuracyM: r.accuracy_m,
    note: r.note,
    entranceInfo: r.entrance_info ?? undefined,
    obstaclesNote: r.obstacles_note ?? undefined,
    favorite: r.favorite,
    proximityEnabled: r.proximity_enabled,
    createdAt: Date.parse(r.place_created_at),
    lastVisitedAt: r.last_visited_at ? Date.parse(r.last_visited_at) : null,
    updatedAt: Date.parse(r.updated_at),
  };
}

export async function syncPlaces(store: PlacesStore): Promise<PlacesSyncOutcome> {
  const client = getSupabaseClient();
  if (!client) return 'unconfigured';
  try {
    const { data: userData } = await client.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return 'signed-out';

    // Pull first: adopt server rows that are newer than local copies.
    const { data: rows, error: pullError } = await client
      .from('saved_places')
      .select('*')
      .eq('user_id', userId);
    if (pullError) return 'failed';
    const local = await store.list();
    const localById = new Map(local.map((p) => [p.id, p]));
    for (const row of (rows ?? []) as SavedPlaceRow[]) {
      const remote = fromRow(row);
      const existing = localById.get(remote.id);
      if (!existing || remote.updatedAt > existing.updatedAt) {
        await store.upsert(remote);
      }
    }

    // Push local state (upsert by (user_id, local_id)).
    const merged = await store.list();
    if (merged.length > 0) {
      const { error: pushError } = await client
        .from('saved_places')
        .upsert(merged.map((p) => toRow(p, userId)), { onConflict: 'user_id,local_id' });
      if (pushError) return 'failed';
    }
    return 'synced';
  } catch {
    return 'failed';
  }
}
