/**
 * "My location" status derivation — PURE. The card feeds it real
 * signals (an in-flight flag, the OS permission read, the
 * services-enabled read, and the actual fix — never a fabricated one)
 * and displays exactly the state they imply.
 *
 * Freshness is honest: a fix counts as 'fresh' for at most 3 minutes;
 * after that it is 'stale' ("last known location"), never "current".
 * The displayed fix AGE is qualitative only (docs/COPY.md):
 *   < 60 s → fixAgeNow, < 120 s → fixAgeOneMinute, else fixAgeFewMinutes.
 * Accuracy quality follows the Smart Place Memory convention: a rounded
 * accuracy is only trusted at ≤ 50 m ('good'); above that, 'poor'.
 */
import { t } from '../i18n/strings';
import type { GeoFix } from '../places/currentFix';

export type FixAgeClass = 'fresh' | 'stale';

export const FRESH_FIX_MAX_AGE_MS = 180_000;

export function classifyFixAge(ageMs: number): FixAgeClass {
  return ageMs <= FRESH_FIX_MAX_AGE_MS ? 'fresh' : 'stale';
}

export type AccuracyQuality = 'good' | 'poor' | 'unknown';

export function accuracyQuality(accuracyM: number | null): AccuracyQuality {
  if (accuracyM === null) return 'unknown';
  return accuracyM <= 50 ? 'good' : 'poor';
}

export type MyLocationState =
  | 'locating'
  | 'fresh'
  | 'stale'
  | 'permission-denied'
  | 'services-off'
  | 'no-fix';

export type PermissionSignal = 'granted' | 'denied' | 'unknown';

export interface MyLocationSignals {
  /** A fix request is in flight right now. */
  locating: boolean;
  /** Foreground permission as last read from the OS. */
  permission: PermissionSignal;
  /** Location services enabled on the device; null = not read yet. */
  servicesEnabled: boolean | null;
  /** The real fix, or null when none has been obtained. */
  fix: GeoFix | null;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
}

/**
 * Precedence (first match wins):
 *   locating → services-off (only when the read is exactly false) →
 *   permission-denied → no-fix → fresh/stale by fix age.
 */
export function deriveMyLocationState(s: MyLocationSignals): MyLocationState {
  if (s.locating) return 'locating';
  if (s.servicesEnabled === false) return 'services-off';
  if (s.permission === 'denied') return 'permission-denied';
  if (s.fix === null) return 'no-fix';
  return classifyFixAge((s.now ?? Date.now()) - s.fix.at);
}

/** Qualitative fix-age label (never an exact minute count). */
export function formatFixAge(lang: 'en' | 'ar', ageMs: number): string {
  if (ageMs < 60_000) return t(lang, 'fixAgeNow');
  if (ageMs < 120_000) return t(lang, 'fixAgeOneMinute');
  return t(lang, 'fixAgeFewMinutes');
}
