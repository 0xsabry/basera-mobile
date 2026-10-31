/**
 * Reverse-geocoding tests: pure address formatting (EN/AR, missing
 * parts), Nominatim request shape (lat/lon order, Accept-Language),
 * per-cell+language caching, the ≤1 req/sec + ~100 m throttle,
 * latest-wins stale rejection, the Nominatim → device → none
 * fallback chain, and the approximate-accuracy flag.
 *
 * No network: fetch is always injected; the device geocoder is
 * injected too (jest's expo mock has no reverseGeocodeAsync).
 */
import {
  createGeocoder,
  formatAddress,
  type FetchImpl,
  type Geocoder,
} from '../geocode';
import type { GeoFix } from '../currentFix';

const CAIRO: GeoFix = { lat: 30.0444, lng: 31.2357, accuracyM: 20, at: 1000 };
const NOMINATIM_EN = {
  address: {
    road: 'Tahrir Street',
    suburb: 'Downtown',
    city: 'Cairo',
    state: 'Cairo Governorate',
    country: 'Egypt',
  },
};

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

function okJson(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

function recordingFetch(payload: unknown) {
  const calls: RecordedCall[] = [];
  const fetchImpl: FetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return okJson(payload);
  };
  return { calls, fetchImpl };
}

interface Harness {
  geocoder: Geocoder;
  advance: (ms: number) => void;
}

function makeGeocoder(
  fetchImpl: FetchImpl,
  extra: Partial<Parameters<typeof createGeocoder>[0]> = {},
): Harness {
  let fakeNow = 1_000_000;
  const geocoder = createGeocoder({
    fetchImpl,
    now: () => fakeNow,
    sleep: async (ms: number) => {
      fakeNow += ms;
    },
    deviceGeocode: async () => [],
    ...extra,
  });
  return {
    geocoder,
    advance: (ms: number) => {
      fakeNow += ms;
    },
  };
}

describe('formatAddress', () => {
  it('(1) EN full payload joins parts in priority order', () => {
    expect(
      formatAddress(
        {
          road: 'Tahrir Street',
          suburb: 'Downtown',
          neighbourhood: 'Ignored Quarter',
          quarter: 'Ignored Too',
          city: 'Cairo',
          town: 'Ignored Town',
          village: 'Ignored Village',
          state: 'Cairo Governorate',
          country: 'Egypt',
        },
        'en',
      ),
    ).toBe('Tahrir Street, Downtown, Cairo, Cairo Governorate, Egypt');
  });

  it('(2) AR payload joins with the Arabic comma', () => {
    expect(
      formatAddress(
        {
          road: 'شارع التحرير',
          suburb: 'وسط البلد',
          city: 'القاهرة',
          state: 'محافظة القاهرة',
          country: 'مصر',
        },
        'ar',
      ),
    ).toBe('شارع التحرير، وسط البلد، القاهرة، محافظة القاهرة، مصر');
  });

  it('(3) missing fields are skipped; all missing → null', () => {
    expect(
      formatAddress(
        { neighbourhood: 'Garden City', village: 'Some Village', country: 'Egypt' },
        'en',
      ),
    ).toBe('Garden City, Some Village, Egypt');
    expect(formatAddress({}, 'en')).toBeNull();
    expect(formatAddress({ road: '   ', city: '' }, 'ar')).toBeNull();
    expect(formatAddress(null, 'en')).toBeNull();
    expect(formatAddress(undefined, 'en')).toBeNull();
  });
});

describe('Nominatim request shape', () => {
  it('(4) puts lat and lon in the right params', async () => {
    const { calls, fetchImpl } = recordingFetch(NOMINATIM_EN);
    const { geocoder } = makeGeocoder(fetchImpl);
    const res = await geocoder.resolveAddress(CAIRO, 'en');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(
      'https://nominatim.openstreetmap.org/reverse?',
    );
    expect(calls[0].url).toContain('lat=30.0444&lon=31.2357');
    expect(calls[0].url).toContain('format=jsonv2');
    expect(calls[0].url).toContain('addressdetails=1');
    expect(calls[0].headers['User-Agent']).toBe(
      'BASERA/1.1 (me.auramarketing.basera)',
    );
    expect(res.address).toBe(
      'Tahrir Street, Downtown, Cairo, Cairo Governorate, Egypt',
    );
    expect(res.source).toBe('nominatim');
    expect(res.forFixAt).toBe(CAIRO.at);
    expect(res.stale).toBe(false);
  });

  it('(5) Accept-Language follows the requested language', async () => {
    const { calls, fetchImpl } = recordingFetch(NOMINATIM_EN);
    const { geocoder } = makeGeocoder(fetchImpl);
    await geocoder.resolveAddress(CAIRO, 'ar');
    expect(calls[0].headers['Accept-Language']).toBe('ar');
  });
});

describe('cache + throttle', () => {
  it('(6) same cell + same lang hits cache; different lang refetches', async () => {
    const { calls, fetchImpl } = recordingFetch(NOMINATIM_EN);
    const { geocoder } = makeGeocoder(fetchImpl);
    const first = await geocoder.resolveAddress(CAIRO, 'en');
    // Same ~100 m cell (rounds to the same 3-decimal key), newer fix.
    const second = await geocoder.resolveAddress(
      { ...CAIRO, lat: 30.04441, at: 2000 },
      'en',
    );
    expect(calls).toHaveLength(1);
    expect(second.address).toBe(first.address);
    expect(second.forFixAt).toBe(2000);

    const arabic = await geocoder.resolveAddress(CAIRO, 'ar');
    expect(calls).toHaveLength(2);
    expect(calls[1].headers['Accept-Language']).toBe('ar');
    expect(arabic.source).toBe('nominatim');
  });

  it('(7) a fix <100 m away within the interval reuses the last result', async () => {
    const { calls, fetchImpl } = recordingFetch(NOMINATIM_EN);
    const { geocoder } = makeGeocoder(fetchImpl);
    const first = await geocoder.resolveAddress(CAIRO, 'en');
    // ~50 m north, a different 3-decimal cell, no time has passed.
    const near: GeoFix = { lat: 30.0449, lng: 31.2357, accuracyM: 20, at: 2000 };
    const second = await geocoder.resolveAddress(near, 'en');
    expect(calls).toHaveLength(1);
    expect(second.address).toBe(first.address);
    expect(second.source).toBe('nominatim');
    expect(second.forFixAt).toBe(2000);
  });
});

describe('latest-wins', () => {
  it('(8) a slow earlier response is discarded as stale', async () => {
    const resolvers: ((v: ReturnType<typeof okJson>) => void)[] = [];
    const fetchImpl: FetchImpl = () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      });
    const { geocoder } = makeGeocoder(fetchImpl);
    const fixA: GeoFix = { ...CAIRO, at: 1000 };
    const fixB: GeoFix = { lat: 31.2001, lng: 29.9187, accuracyM: 20, at: 2000 };

    const pA = geocoder.resolveAddress(fixA, 'en');
    const pB = geocoder.resolveAddress(fixB, 'en');
    // Let both requests reach their (deferred) fetch calls.
    await new Promise((r) => setImmediate(r));
    expect(resolvers).toHaveLength(2);

    // The newer request resolves first and is current.
    resolvers[1](
      okJson({
        address: { road: 'Corniche Road', city: 'Alexandria', country: 'Egypt' },
      }),
    );
    const resB = await pB;
    expect(resB.stale).toBe(false);
    expect(resB.forFixAt).toBe(2000);
    expect(resB.address).toBe('Corniche Road, Alexandria, Egypt');

    // The older request resolves last — never current.
    resolvers[0](okJson(NOMINATIM_EN));
    const resA = await pA;
    expect(resA.stale).toBe(true);
    expect(resA.forFixAt).toBe(1000);
    expect(resA.forFixAt).not.toBe(resB.forFixAt);
  });
});

describe('fallback chain', () => {
  it('(9) Nominatim failure falls back to the device geocoder', async () => {
    const failingFetch: FetchImpl = async () => {
      throw new Error('network down');
    };
    const { geocoder } = makeGeocoder(failingFetch, {
      deviceGeocode: async () => [
        {
          street: 'Nile Street',
          district: 'Zamalek',
          city: 'Cairo',
          region: 'Cairo Governorate',
          country: 'Egypt',
        },
      ],
    });
    const res = await geocoder.resolveAddress(CAIRO, 'en');
    expect(res.source).toBe('device');
    expect(res.address).toBe(
      'Nile Street, Zamalek, Cairo, Cairo Governorate, Egypt',
    );
  });

  it('(9b) an empty Nominatim answer also falls back to the device', async () => {
    const { fetchImpl } = recordingFetch({ display_name: 'Somewhere' });
    const { geocoder } = makeGeocoder(fetchImpl, {
      deviceGeocode: async () => [{ city: 'Giza', country: 'Egypt' }],
    });
    const res = await geocoder.resolveAddress(CAIRO, 'en');
    expect(res.source).toBe('device');
    expect(res.address).toBe('Giza, Egypt');
  });

  it('(9c) both sources failing yields source none and no address', async () => {
    const failingFetch: FetchImpl = async () => {
      throw new Error('network down');
    };
    const { geocoder } = makeGeocoder(failingFetch, {
      deviceGeocode: async () => {
        throw new Error('no device geocoder');
      },
    });
    const res = await geocoder.resolveAddress(CAIRO, 'en');
    expect(res.source).toBe('none');
    expect(res.address).toBeNull();
    expect(res.forFixAt).toBe(CAIRO.at);
  });
});

describe('approximate flag', () => {
  it('(10) accuracy 150 → true, 30 → false, null → true', async () => {
    const { fetchImpl } = recordingFetch(NOMINATIM_EN);
    const coarse = await makeGeocoder(fetchImpl).geocoder.resolveAddress(
      { ...CAIRO, accuracyM: 150 },
      'en',
    );
    expect(coarse.approximate).toBe(true);
    const fine = await makeGeocoder(fetchImpl).geocoder.resolveAddress(
      { ...CAIRO, accuracyM: 30 },
      'en',
    );
    expect(fine.approximate).toBe(false);
    const unknown = await makeGeocoder(fetchImpl).geocoder.resolveAddress(
      { ...CAIRO, accuracyM: null },
      'en',
    );
    expect(unknown.approximate).toBe(true);
  });
});
