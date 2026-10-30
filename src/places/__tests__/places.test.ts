/**
 * Place Memory tests: normalization/matching, haversine, honest
 * distance phrasing, store CRUD + search, proximity checker, and the
 * voice assistant (real store + fake fixes).
 */
import { PlacesAssistant, describePlace } from '../PlacesAssistant';
import { PlacesStore, type Place, type PlacesStorage } from '../PlacesStore';
import { distanceStatement, haversineMeters, normalizePlaceName, placeNameMatches } from '../placesText';
import { checkProximity } from '../proximity';
import type { GeoFix } from '../currentFix';

function memoryStorage(): PlacesStorage {
  let value: string | null = null;
  return {
    getItem: async () => value,
    setItem: async (_k, v) => {
      value = v;
    },
  };
}

describe('normalizePlaceName / matching', () => {
  it('normalizes ة/ه, ي/ى, hamza forms and diacritics', () => {
    expect(normalizePlaceName('الجامعة')).toBe(normalizePlaceName('الجامعه'));
    expect(normalizePlaceName('مستشفى')).toBe(normalizePlaceName('مستشفي'));
    expect(normalizePlaceName('الإسكندرية')).toBe(normalizePlaceName('الاسكندريه'));
    expect(normalizePlaceName('بَيت')).toBe(normalizePlaceName('بيت'));
  });
  it('matches exactly after normalization, then by substring', () => {
    expect(placeNameMatches('الجامعة', 'الجامعه')).toBe(true);
    expect(placeNameMatches('صيدلية النور', 'النور')).toBe(true);
    expect(placeNameMatches('البيت', 'الشغل')).toBe(false);
  });
});

describe('haversineMeters', () => {
  it('is ~111 km for one degree of latitude and 0 for the same point', () => {
    const d = haversineMeters({ lat: 30, lng: 31 }, { lat: 31, lng: 31 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
    expect(haversineMeters({ lat: 30, lng: 31 }, { lat: 30, lng: 31 })).toBe(0);
  });
});

describe('distanceStatement — honesty rules', () => {
  it('gives a rounded number only when accuracy <= 50 m', () => {
    const ok = distanceStatement(123, 20, 150);
    expect(ok.meters).toBe(120);
    expect(ok.band).toBe('near');
    const coarse = distanceStatement(123, 200, 150);
    expect(coarse.meters).toBeNull();
    expect(coarse.band).toBe('near');
    const unknown = distanceStatement(900, null, 150);
    expect(unknown.meters).toBeNull();
    expect(unknown.band).toBe('far');
  });
});

describe('PlacesStore', () => {
  it('CRUD + normalized search + visited + notes', async () => {
    const store = new PlacesStore(memoryStorage());
    const home = await store.add({
      name: 'البيت', category: 'home', lat: 30, lng: 31, accuracyM: 12,
      note: '', favorite: false, proximityEnabled: true,
    });
    await store.add({
      name: 'الجامعة', category: 'university', lat: 30.1, lng: 31.1, accuracyM: 30,
      note: 'بوابة رئيسية', favorite: false, proximityEnabled: true,
    });
    expect(await store.list()).toHaveLength(2);
    // spoken variant with ه instead of ة must find الجامعة
    expect((await store.findByName('الجامعه'))?.name).toBe('الجامعة');
    expect((await store.search('جامعه'))).toHaveLength(1);
    await store.markVisited(home.id, 12345);
    expect((await store.list()).find((p) => p.id === home.id)?.lastVisitedAt).toBe(12345);
    await store.setNote(home.id, 'فيه سلم عند المدخل');
    expect((await store.list()).find((p) => p.id === home.id)?.note).toContain('سلم');
    await store.remove(home.id);
    expect(await store.list()).toHaveLength(1);
  });
});

const basePlace = (over: Partial<Place>): Place => ({
  id: 'p1', name: 'A', category: 'custom', lat: 30, lng: 31, accuracyM: 10,
  note: '', favorite: false, proximityEnabled: true,
  createdAt: 1, updatedAt: 1, lastVisitedAt: null, ...over,
});

describe('checkProximity', () => {
  const fix: GeoFix = { lat: 30, lng: 31, accuracyM: 10, at: 1000 };
  it('hits within radius, respects per-place enable + 30 min cooldown', () => {
    const near = basePlace({ id: 'n', lat: 30.0005, lng: 31 }); // ~55 m
    const far = basePlace({ id: 'f', lat: 30.01, lng: 31 }); // ~1.1 km
    const off = basePlace({ id: 'o', lat: 30.0005, lng: 31, proximityEnabled: false });
    const hits = checkProximity(fix, [near, far, off], { radiusM: 150, lastNotifiedAt: {}, now: 10_000 });
    expect(hits.map((h) => h.place.id)).toEqual(['n']);
    const cooled = checkProximity(fix, [near], {
      radiusM: 150, lastNotifiedAt: { n: 9_000 }, now: 10_000,
    });
    expect(cooled).toHaveLength(0);
    const after = checkProximity(fix, [near], {
      radiusM: 150, lastNotifiedAt: { n: 0 }, now: 31 * 60 * 1000,
    });
    expect(after).toHaveLength(1);
  });
});

describe('PlacesAssistant — honest, real-data answers', () => {
  const goodFix: GeoFix = { lat: 30, lng: 31, accuracyM: 15, at: 1 };
  function make(getFix: () => Promise<{ fix: GeoFix | null; error: 'permission' | 'unavailable' | null }>) {
    const store = new PlacesStore(memoryStorage());
    const assistant = new PlacesAssistant({ store, getFix, proximityRadiusM: () => 150 });
    return { store, assistant };
  }

  it('save requires a real fix; without one nothing is saved', async () => {
    const { store, assistant } = make(async () => ({ fix: null, error: 'permission' }));
    const msg = await assistant.savePlace('en', 'Home');
    expect(msg).toContain('unavailable');
    expect(await store.list()).toHaveLength(0);
  });

  it('save with a fix stores coordinates + warns on low accuracy', async () => {
    const badFix: GeoFix = { lat: 30, lng: 31, accuracyM: 300, at: 1 };
    const { store, assistant } = make(async () => ({ fix: badFix, error: null }));
    const msg = await assistant.savePlace('en', 'Work');
    expect(msg).toContain('accuracy is low');
    expect((await store.list())[0].accuracyM).toBe(300);
  });

  it('near: no fix → honest "cannot tell"; with fix + good accuracy → rounded meters', async () => {
    const { store, assistant } = make(async () => ({ fix: goodFix, error: null }));
    await store.add({
      name: 'البيت', category: 'home', lat: 30.001, lng: 31, accuracyM: 10,
      note: '', favorite: false, proximityEnabled: true,
    });
    const near = await assistant.nearPlace('en', 'البيت');
    expect(near).toMatch(/about \d+ meters away/);
    const noFix = new PlacesAssistant({
      store, getFix: async () => ({ fix: null, error: 'unavailable' }), proximityRadiusM: () => 150,
    });
    expect(await noFix.nearPlace('en', 'البيت')).toContain('cannot get your location');
  });

  it('find returns the real stored description; unknown names are reported, not invented', async () => {
    const { store, assistant } = make(async () => ({ fix: goodFix, error: null }));
    await store.add({
      name: 'النادي', category: 'custom', lat: 30.01, lng: 31, accuracyM: 10,
      note: 'مدخل جانبي', favorite: false, proximityEnabled: true,
    });
    const found = await assistant.findPlace('ar', 'النادي');
    expect(found).toContain('مدخل جانبي');
    expect(await assistant.findPlace('ar', 'مكان مش موجود')).toContain('ملقيتش');
    expect(describePlace('en', (await store.list())[0])).toContain('النادي');
  });

  it('delete removes by normalized name', async () => {
    const { store, assistant } = make(async () => ({ fix: goodFix, error: null }));
    await store.add({
      name: 'الجامعة', category: 'university', lat: 30, lng: 31, accuracyM: 10,
      note: '', favorite: false, proximityEnabled: true,
    });
    await assistant.deletePlace('ar', 'الجامعه');
    expect(await store.list()).toHaveLength(0);
  });
});
