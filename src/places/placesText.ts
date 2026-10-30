/**
 * Pure place-text + geo helpers (unit-tested):
 * - Arabic-aware name normalization for search: spoken names vary in
 *   ة/ه, ي/ى, hamza forms and diacritics; matching must forgive that.
 * - Haversine distance.
 * - Honest distance phrasing: a rounded number is only produced when
 *   the GPS accuracy supports it; otherwise a qualitative near/far.
 */

export function normalizePlaceName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, '') // Arabic diacritics
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[؟?.,!،؛:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the query matches the place name (exact, then substring). */
export function placeNameMatches(placeName: string, query: string): boolean {
  const p = normalizePlaceName(placeName);
  const q = normalizePlaceName(query);
  if (!q) return false;
  return p === q || p.includes(q) || q.includes(p);
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface DistanceStatement {
  /** Rounded meters when accuracy supports a number; otherwise null. */
  meters: number | null;
  /** Qualitative band — the only claim made when meters is null. */
  band: 'near' | 'far';
}

/**
 * Decide what may honestly be said about a distance:
 * - accuracy ≤ 50 m → rounded number (nearest 10 m under 200 m,
 *   nearest 50 m above).
 * - worse/unknown accuracy → qualitative band only, using the user's
 *   proximity radius as the near threshold.
 */
export function distanceStatement(
  distanceM: number,
  accuracyM: number | null,
  nearRadiusM: number,
): DistanceStatement {
  const band: 'near' | 'far' = distanceM <= nearRadiusM ? 'near' : 'far';
  if (accuracyM !== null && accuracyM <= 50) {
    const meters = distanceM < 200 ? Math.round(distanceM / 10) * 10 : Math.round(distanceM / 50) * 50;
    return { meters, band };
  }
  return { meters: null, band };
}
