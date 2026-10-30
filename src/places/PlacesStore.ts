/**
 * Smart Place Memory store — the user's own named places, stored ONLY
 * on this device by default (AsyncStorage). Cloud sync is an explicit
 * opt-in (see placesSync.ts) and guardians NEVER get access to these
 * records (separate table, owner-only RLS — migration 0004).
 *
 * Voice notes are stored as TRANSCRIBED TEXT only. No audio is recorded
 * or stored anywhere by this module.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizePlaceName, placeNameMatches } from './placesText';

const STORAGE_KEY = 'basera.places.v1';
export const MAX_PLACES = 200;

export type PlaceCategory =
  | 'home'
  | 'university'
  | 'work'
  | 'family'
  | 'hospital'
  | 'pharmacy'
  | 'shop'
  | 'mosque'
  | 'transport'
  | 'custom';

export const PLACE_CATEGORIES: PlaceCategory[] = [
  'home', 'university', 'work', 'family', 'hospital',
  'pharmacy', 'shop', 'mosque', 'transport', 'custom',
];

export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  /** GPS accuracy (meters) at save time; null when unknown. */
  accuracyM: number | null;
  /** User note / description — text only (voice notes are transcripts). */
  note: string;
  entranceInfo?: string;
  obstaclesNote?: string;
  favorite: boolean;
  proximityEnabled: boolean;
  createdAt: number;
  lastVisitedAt: number | null;
  /** Server sync bookkeeping (local-only field). */
  updatedAt: number;
}

export interface PlacesStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const defaultStorage: PlacesStorage = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
};

export type NewPlace = Omit<Place, 'id' | 'createdAt' | 'updatedAt' | 'lastVisitedAt'> &
  Partial<Pick<Place, 'lastVisitedAt'>>;

export class PlacesStore {
  constructor(private readonly storage: PlacesStorage = defaultStorage) {}

  async list(): Promise<Place[]> {
    try {
      const raw = await this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Place[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async saveAll(places: Place[]): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(places.slice(0, MAX_PLACES)));
  }

  async add(input: NewPlace): Promise<Place> {
    const now = Date.now();
    const place: Place = {
      ...input,
      id: `p-${now}-${Math.floor(Math.random() * 1e6)}`,
      createdAt: now,
      updatedAt: now,
      lastVisitedAt: input.lastVisitedAt ?? null,
    };
    const places = [place, ...(await this.list())];
    await this.saveAll(places);
    return place;
  }

  async update(id: string, patch: Partial<Omit<Place, 'id' | 'createdAt'>>): Promise<Place | null> {
    const places = await this.list();
    const idx = places.findIndex((p) => p.id === id);
    if (idx < 0) return null;
    const next = { ...places[idx], ...patch, updatedAt: Date.now() };
    places[idx] = next;
    await this.saveAll(places);
    return next;
  }

  /** Insert-or-replace by id (used by cloud sync pull). */
  async upsert(place: Place): Promise<void> {
    const places = await this.list();
    const idx = places.findIndex((p) => p.id === place.id);
    if (idx >= 0) places[idx] = place;
    else places.unshift(place);
    await this.saveAll(places);
  }

  async remove(id: string): Promise<void> {
    await this.saveAll((await this.list()).filter((p) => p.id !== id));
  }

  async markVisited(id: string, at: number = Date.now()): Promise<void> {
    await this.update(id, { lastVisitedAt: at });
  }

  async setNote(id: string, note: string): Promise<Place | null> {
    const existing = (await this.list()).find((p) => p.id === id);
    if (!existing) return null;
    const combined = existing.note ? `${existing.note} — ${note}` : note;
    return this.update(id, { note: combined });
  }

  /** Find a place by spoken/typed name (Arabic-normalized matching). */
  async findByName(query: string): Promise<Place | null> {
    const places = await this.list();
    const q = normalizePlaceName(query);
    const exact = places.find((p) => normalizePlaceName(p.name) === q);
    if (exact) return exact;
    return places.find((p) => placeNameMatches(p.name, query)) ?? null;
  }

  async search(query: string): Promise<Place[]> {
    const places = await this.list();
    return places.filter((p) => placeNameMatches(p.name, query));
  }

  async clear(): Promise<void> {
    await this.saveAll([]);
  }
}

export const placesStore = new PlacesStore();
