/**
 * Voice-facing Place Memory assistant. Every answer is composed from
 * REAL store data and a REAL current fix — when the fix is unavailable
 * it says so and invents neither distance nor direction. All methods
 * return the exact text to speak/display, in the user's language.
 */
import type { AppLanguage } from '../ai/types';
import { t, type StringKey } from '../i18n/strings';
import type { GeoFix } from './currentFix';
import type { Place, PlacesStore } from './PlacesStore';
import { distanceStatement, haversineMeters } from './placesText';

export interface PlacesAssistantDeps {
  store: PlacesStore;
  getFix: () => Promise<{ fix: GeoFix | null; error: 'permission' | 'unavailable' | null }>;
  proximityRadiusM: () => number;
}

const CATEGORY_KEY: Record<Place['category'], StringKey> = {
  home: 'placesCategoryHome',
  university: 'placesCategoryUniversity',
  work: 'placesCategoryWork',
  family: 'placesCategoryFamily',
  hospital: 'placesCategoryHospital',
  pharmacy: 'placesCategoryPharmacy',
  shop: 'placesCategoryShop',
  mosque: 'placesCategoryMosque',
  transport: 'placesCategoryTransport',
  custom: 'placesCategoryCustom',
};

export function categoryLabel(lang: AppLanguage, category: Place['category']): string {
  return t(lang, CATEGORY_KEY[category]);
}

/** Full spoken description of one place (used by Listen + find + repeat). */
export function describePlace(lang: AppLanguage, place: Place): string {
  const parts: string[] = [place.name, categoryLabel(lang, place.category)];
  if (place.note) parts.push(place.note);
  if (place.entranceInfo) parts.push(place.entranceInfo);
  if (place.obstaclesNote) parts.push(place.obstaclesNote);
  if (place.lastVisitedAt) {
    parts.push(
      `${t(lang, 'placesLastVisited')}: ${new Date(place.lastVisitedAt).toLocaleDateString(
        lang === 'ar' ? 'ar-EG' : 'en-US',
      )}`,
    );
  }
  return parts.join('. ');
}

export class PlacesAssistant {
  private lastDescription: string | null = null;

  constructor(private deps: PlacesAssistantDeps) {}

  async savePlace(lang: AppLanguage, name: string): Promise<string> {
    const { fix, error } = await this.deps.getFix();
    if (!fix) {
      return error === 'permission'
        ? t(lang, 'placesLocationUnavailable')
        : t(lang, 'placesVoiceNoLocation');
    }
    const place = await this.deps.store.add({
      name,
      category: 'custom',
      lat: fix.lat,
      lng: fix.lng,
      accuracyM: fix.accuracyM,
      note: '',
      favorite: false,
      proximityEnabled: true,
    });
    this.lastDescription = describePlace(lang, place);
    let msg = `${t(lang, 'placesVoiceSaved')}: ${name}`;
    if (fix.accuracyM !== null && fix.accuracyM > 100) {
      msg += `. ${t(lang, 'placesLowAccuracy')}`;
    }
    return msg;
  }

  async addNote(lang: AppLanguage, placeName: string | null, note: string): Promise<string> {
    let place: Place | null = null;
    if (placeName) place = await this.deps.store.findByName(placeName);
    if (!place) {
      const all = await this.deps.store.list();
      place = all[0] ?? null; // most recently saved
    }
    if (!place) return t(lang, 'placesVoiceListEmpty');
    await this.deps.store.setNote(place.id, note);
    return `${t(lang, 'placesVoiceNoteAdded')}: ${place.name}`;
  }

  async listPlaces(lang: AppLanguage): Promise<string> {
    const places = await this.deps.store.list();
    if (places.length === 0) return t(lang, 'placesVoiceListEmpty');
    const names = places.map((p) => p.name).join(lang === 'ar' ? '، ' : ', ');
    return `${t(lang, 'placesVoiceListIntro')}: ${names}`;
  }

  private async distancePart(lang: AppLanguage, place: Place): Promise<string | null> {
    const { fix } = await this.deps.getFix();
    if (!fix) return null;
    const d = haversineMeters(fix, place);
    const st = distanceStatement(d, fix.accuracyM, this.deps.proximityRadiusM());
    if (st.meters !== null) {
      return `${t(lang, 'placesVoiceDistance')} ${st.meters} ${t(lang, 'placesVoiceMeters')}`;
    }
    return st.band === 'near'
      ? t(lang, 'placesVoiceNear') + `: ${place.name}`
      : `${place.name} ${t(lang, 'placesVoiceFar')}`;
  }

  async findPlace(lang: AppLanguage, name: string): Promise<string> {
    const place = await this.deps.store.findByName(name);
    if (!place) return t(lang, 'placesVoiceNotFound');
    const desc = describePlace(lang, place);
    this.lastDescription = desc;
    const dist = await this.distancePart(lang, place);
    return dist ? `${desc}. ${dist}` : desc;
  }

  async nearPlace(lang: AppLanguage, name: string): Promise<string> {
    const place = await this.deps.store.findByName(name);
    if (!place) return t(lang, 'placesVoiceNotFound');
    const { fix } = await this.deps.getFix();
    if (!fix) return t(lang, 'placesVoiceNoLocation');
    const d = haversineMeters(fix, place);
    const st = distanceStatement(d, fix.accuracyM, this.deps.proximityRadiusM());
    if (st.meters !== null) {
      return `${t(lang, 'placesVoiceDistance')} ${st.meters} ${t(lang, 'placesVoiceMeters')}: ${place.name}`;
    }
    return st.band === 'near'
      ? `${t(lang, 'placesVoiceNear')}: ${place.name}`
      : `${place.name} ${t(lang, 'placesVoiceFar')}`;
  }

  async deletePlace(lang: AppLanguage, name: string): Promise<string> {
    const place = await this.deps.store.findByName(name);
    if (!place) return t(lang, 'placesVoiceNotFound');
    await this.deps.store.remove(place.id);
    return `${t(lang, 'placesVoiceDeleted')}: ${place.name}`;
  }

  repeatDescription(lang: AppLanguage): string {
    return this.lastDescription ?? t(lang, 'nothingToRepeat');
  }
}
