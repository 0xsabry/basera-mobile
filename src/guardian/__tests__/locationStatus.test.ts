import type { GeoFix } from '../../places/currentFix';
import {
  accuracyQuality,
  classifyFixAge,
  deriveMyLocationState,
  formatFixAge,
  type MyLocationSignals,
} from '../locationStatus';

const NOW = 1_700_000_000_000;

function fixAt(at: number, accuracyM: number | null = 20): GeoFix {
  return { lat: 30.0444, lng: 31.2357, accuracyM, at };
}

function signals(overrides: Partial<MyLocationSignals> = {}): MyLocationSignals {
  return {
    locating: false,
    permission: 'granted',
    servicesEnabled: true,
    fix: fixAt(NOW),
    now: NOW,
    ...overrides,
  };
}

describe('classifyFixAge', () => {
  it('is fresh up to and including 180000 ms, stale after', () => {
    expect(classifyFixAge(0)).toBe('fresh');
    expect(classifyFixAge(179_999)).toBe('fresh');
    expect(classifyFixAge(180_000)).toBe('fresh');
    expect(classifyFixAge(180_001)).toBe('stale');
    expect(classifyFixAge(3_600_000)).toBe('stale');
  });
});

describe('accuracyQuality', () => {
  it('is good at exactly 50 m, poor above, unknown when null', () => {
    expect(accuracyQuality(0)).toBe('good');
    expect(accuracyQuality(50)).toBe('good');
    expect(accuracyQuality(51)).toBe('poor');
    expect(accuracyQuality(500)).toBe('poor');
    expect(accuracyQuality(null)).toBe('unknown');
  });
});

describe('deriveMyLocationState', () => {
  it('fresh: granted + services on + a fix within 3 minutes', () => {
    expect(deriveMyLocationState(signals())).toBe('fresh');
    expect(deriveMyLocationState(signals({ fix: fixAt(NOW - 180_000) }))).toBe('fresh');
  });

  it('stale: a fix older than 3 minutes', () => {
    expect(deriveMyLocationState(signals({ fix: fixAt(NOW - 180_001) }))).toBe('stale');
  });

  it('no-fix: granted but no fix obtained (unknown services read does not block)', () => {
    expect(deriveMyLocationState(signals({ fix: null }))).toBe('no-fix');
    expect(deriveMyLocationState(signals({ fix: null, servicesEnabled: null }))).toBe('no-fix');
    expect(deriveMyLocationState(signals({ fix: null, permission: 'unknown' }))).toBe('no-fix');
  });

  it('permission-denied: denied permission, even before any fix attempt', () => {
    expect(deriveMyLocationState(signals({ permission: 'denied', fix: null }))).toBe('permission-denied');
  });

  it('services-off: services read exactly false', () => {
    expect(deriveMyLocationState(signals({ servicesEnabled: false }))).toBe('services-off');
  });

  it('precedence: locating beats everything', () => {
    expect(
      deriveMyLocationState(
        signals({ locating: true, servicesEnabled: false, permission: 'denied', fix: null }),
      ),
    ).toBe('locating');
  });

  it('precedence: services-off beats permission-denied', () => {
    expect(
      deriveMyLocationState(signals({ servicesEnabled: false, permission: 'denied', fix: null })),
    ).toBe('services-off');
  });

  it('precedence: permission-denied beats an existing fix', () => {
    expect(deriveMyLocationState(signals({ permission: 'denied' }))).toBe('permission-denied');
  });
});

describe('formatFixAge (qualitative only, per docs/COPY.md)', () => {
  it('thresholds: <60s now, <120s one minute, else a few minutes (en)', () => {
    expect(formatFixAge('en', 0)).toBe('just now');
    expect(formatFixAge('en', 59_999)).toBe('just now');
    expect(formatFixAge('en', 60_000)).toBe('1 minute ago');
    expect(formatFixAge('en', 119_999)).toBe('1 minute ago');
    expect(formatFixAge('en', 120_000)).toBe('a few minutes ago');
    expect(formatFixAge('en', 3_600_000)).toBe('a few minutes ago');
  });

  it('thresholds hold in Arabic too', () => {
    expect(formatFixAge('ar', 30_000)).toBe('الآن');
    expect(formatFixAge('ar', 90_000)).toBe('قبل دقيقة');
    expect(formatFixAge('ar', 600_000)).toBe('قبل بضع دقائق');
  });
});
