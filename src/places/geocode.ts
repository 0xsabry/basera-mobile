/**
 * Reverse geocoding for the "My location" card — turns a real GeoFix
 * into a human-readable address, or honestly reports that only the
 * coordinates are available.
 *
 * Pipeline (fallback chain, in order):
 *   1. Nominatim (OpenStreetMap) reverse endpoint — the request asks
 *      for the ACTIVE app language via Accept-Language, so Arabic mode
 *      receives Arabic (Egyptian) place names and English mode
 *      receives English ones.
 *   2. The device geocoder (expo-location reverseGeocodeAsync, lazily
 *      required so this module stays headless/test-safe).
 *   3. { source: 'none', address: null } — the caller then shows the
 *      coordinates, clearly labeled as coordinates, never dressed up
 *      as an address.
 *
 * Nominatim usage policy is respected: results are cached per
 * ~100 m cell + language, network calls are spaced at least 1100 ms
 * apart, and a fix within ~100 m of the last geocoded fix (same
 * language) is served from that result instead of the network.
 *
 * Latest-wins: every resolveAddress() call takes a monotonic token.
 * A response that finishes after a newer call was issued is returned
 * flagged `stale: true`, and its `forFixAt` never matches the newer
 * fix — callers must apply a result only when
 * `!result.stale && result.forFixAt === currentFix.at`.
 *
 * Coordinates are NEVER logged here (no console.* anywhere).
 */
import type { GeoFix } from './currentFix';
import { haversineMeters } from './placesText';

export type GeocodeLang = 'en' | 'ar';

/** Address parts in the Nominatim `addressdetails=1` shape. */
export interface AddressDetails {
  road?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  country?: string;
}

export type GeocodeSource = 'nominatim' | 'device' | 'none';

export interface ResolvedAddress {
  /** Display string, or null when no source could name the place. */
  address: string | null;
  /** True when the fix itself is coarse: accuracy unknown or > 100 m. */
  approximate: boolean;
  source: GeocodeSource;
  /** The fix timestamp this result belongs to (GeoFix.at). */
  forFixAt: number;
  /** True when a newer resolveAddress() superseded this one in flight. */
  stale: boolean;
}

/**
 * Pure formatter: build the display string from address parts in a
 * fixed priority — road, then suburb ?? neighbourhood ?? quarter,
 * then city ?? town ?? village, then state, then country. Missing or
 * blank parts are skipped, duplicate parts are shown once, and
 * nothing is ever invented: with no usable part the result is null.
 * Parts join with ', ' (en) or '، ' (ar).
 */
export function formatAddress(
  details: AddressDetails | null | undefined,
  lang: GeocodeLang,
): string | null {
  if (!details) return null;
  const pick = (...values: (string | undefined)[]): string | null => {
    for (const v of values) {
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
    return null;
  };
  const parts = [
    pick(details.road),
    pick(details.suburb, details.neighbourhood, details.quarter),
    pick(details.city, details.town, details.village),
    pick(details.state),
    pick(details.country),
  ].filter((p): p is string => p !== null);
  const unique = parts.filter((p, i) => parts.indexOf(p) === i);
  if (unique.length === 0) return null;
  return unique.join(lang === 'ar' ? '، ' : ', ');
}

/** Address parts as returned by expo-location's reverseGeocodeAsync. */
export interface DeviceAddressParts {
  street?: string | null;
  district?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

/** Adapt device-geocoder parts onto the shared formatter shape. */
export function formatDeviceAddress(
  parts: DeviceAddressParts | null | undefined,
  lang: GeocodeLang,
): string | null {
  if (!parts) return null;
  return formatAddress(
    {
      road: parts.street ?? undefined,
      suburb: parts.district ?? undefined,
      city: parts.city ?? undefined,
      state: parts.region ?? undefined,
      country: parts.country ?? undefined,
    },
    lang,
  );
}

export interface FetchResponseLike {
  ok?: boolean;
  status?: number;
  json(): Promise<unknown>;
}

export type FetchImpl = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<FetchResponseLike>;

export type DeviceGeocoder = (coords: {
  latitude: number;
  longitude: number;
}) => Promise<DeviceAddressParts[]>;

export interface GeocoderOptions {
  /** Injectable fetch (tests pass a fake — no network in jest). */
  fetchImpl?: FetchImpl;
  /** Injectable clock (ms epoch); defaults to Date.now. */
  now?: () => number;
  /** Injectable spacing wait; defaults to a real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable device geocoder; defaults to expo-location (lazy). */
  deviceGeocode?: DeviceGeocoder;
}

export interface Geocoder {
  resolveAddress(fix: GeoFix, lang: GeocodeLang): Promise<ResolvedAddress>;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'BASERA/1.1 (me.auramarketing.basera)';
/** Nominatim policy: at most 1 request/second — we keep 1100 ms. */
const MIN_NETWORK_INTERVAL_MS = 1100;
/** A fix closer than this to the last geocoded one reuses its result. */
const MIN_MOVEMENT_M = 100;

function defaultFetch(url: string, init: { headers: Record<string, string> }) {
  return fetch(url, init) as Promise<FetchResponseLike>;
}

function defaultDeviceGeocode(coords: {
  latitude: number;
  longitude: number;
}): Promise<DeviceAddressParts[]> {
  // Lazy require, mirroring currentFix: keeps this module importable
  // in headless contexts and lets jest's expo mock simply lack the
  // function, which the fallback chain treats as "device failed".
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Location = require('expo-location') as {
    reverseGeocodeAsync?: (
      coords: { latitude: number; longitude: number }[],
    ) => Promise<DeviceAddressParts[]>;
  };
  if (typeof Location.reverseGeocodeAsync !== 'function') {
    return Promise.reject(new Error('device geocoder unavailable'));
  }
  return Location.reverseGeocodeAsync([coords]);
}

interface CachedEntry {
  address: string;
  source: Exclude<GeocodeSource, 'none'>;
}

export function createGeocoder(options: GeocoderOptions = {}): Geocoder {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deviceGeocode = options.deviceGeocode ?? defaultDeviceGeocode;

  const cache = new Map<string, CachedEntry>();
  const lastByLang = new Map<
    GeocodeLang,
    { fix: GeoFix; entry: CachedEntry }
  >();
  let lastNetworkAt: number | null = null;
  let requestToken = 0;

  const cellKey = (fix: GeoFix, lang: GeocodeLang) =>
    `${fix.lat.toFixed(3)},${fix.lng.toFixed(3)}|${lang}`;
  const approximateOf = (fix: GeoFix) =>
    fix.accuracyM === null || fix.accuracyM > 100;

  async function fromNominatim(
    fix: GeoFix,
    lang: GeocodeLang,
  ): Promise<string | null> {
    // Enforce the minimum spacing between network calls.
    if (lastNetworkAt !== null) {
      const wait = MIN_NETWORK_INTERVAL_MS - (now() - lastNetworkAt);
      if (wait > 0) await sleep(wait);
    }
    lastNetworkAt = now();
    const url =
      `${NOMINATIM_URL}?lat=${fix.lat}&lon=${fix.lng}` +
      `&format=jsonv2&zoom=18&addressdetails=1`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': lang },
    });
    if (res.ok === false || (typeof res.status === 'number' && res.status >= 400)) {
      return null;
    }
    const data = (await res.json()) as { address?: AddressDetails } | null;
    return formatAddress(data?.address, lang);
  }

  async function fromDevice(
    fix: GeoFix,
    lang: GeocodeLang,
  ): Promise<string | null> {
    const results = await deviceGeocode({
      latitude: fix.lat,
      longitude: fix.lng,
    });
    for (const parts of results ?? []) {
      const address = formatDeviceAddress(parts, lang);
      if (address) return address;
    }
    return null;
  }

  async function resolveAddress(
    fix: GeoFix,
    lang: GeocodeLang,
  ): Promise<ResolvedAddress> {
    const token = ++requestToken;
    const base = { approximate: approximateOf(fix), forFixAt: fix.at };
    const finish = (entry: CachedEntry | null): ResolvedAddress => ({
      address: entry?.address ?? null,
      source: entry?.source ?? 'none',
      ...base,
      stale: token !== requestToken,
    });

    const key = cellKey(fix, lang);
    const cached = cache.get(key);
    if (cached) return finish(cached);

    // Within ~100 m of the last geocoded fix for this language: reuse
    // its result — no network call, whatever the clock says.
    const last = lastByLang.get(lang);
    if (last && haversineMeters(fix, last.fix) < MIN_MOVEMENT_M) {
      cache.set(key, last.entry);
      return finish(last.entry);
    }

    let entry: CachedEntry | null = null;
    try {
      const address = await fromNominatim(fix, lang);
      if (address) entry = { address, source: 'nominatim' };
    } catch {
      entry = null; // fall through to the device geocoder
    }
    if (!entry) {
      try {
        const address = await fromDevice(fix, lang);
        if (address) entry = { address, source: 'device' };
      } catch {
        entry = null;
      }
    }

    if (entry) {
      cache.set(key, entry);
      lastByLang.set(lang, { fix, entry });
    }
    return finish(entry);
  }

  return { resolveAddress };
}

/** Shared app-wide geocoder (cache/throttle state lives here). */
export const defaultGeocoder: Geocoder = createGeocoder();

/** Convenience wrapper over the shared geocoder. */
export function resolveAddress(
  fix: GeoFix,
  lang: GeocodeLang,
): Promise<ResolvedAddress> {
  return defaultGeocoder.resolveAddress(fix, lang);
}
