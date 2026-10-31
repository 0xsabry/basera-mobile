/**
 * LocationSharingService + LocationBatcher tests with fake adapter and
 * fake guardian service: batching thresholds, permission denial,
 * foreground-only behaviour (AppState background stops the watch), and
 * the disable path that must purge server-side.
 */
import type { GuardianService, LocationPointInput } from '../GuardianService';
import {
  LocationBatcher,
  LocationSharingService,
  type LocationAdapter,
  type LocationSubscriptionLike,
} from '../LocationSharingService';

const pt = (lat: number): LocationPointInput => ({
  lat,
  lng: 31.0,
  accuracyM: 10,
  recordedAt: '2026-10-30T10:00:00Z',
});

describe('LocationBatcher', () => {
  it('flushes at 3 points', () => {
    const b = new LocationBatcher(3, 60_000, () => 1000);
    expect(b.add(pt(1))).toBe(false);
    expect(b.add(pt(2))).toBe(false);
    expect(b.add(pt(3))).toBe(true);
    expect(b.flush()).toHaveLength(3);
    expect(b.size).toBe(0);
  });

  it('flushes after the wait window even with fewer points', () => {
    let now = 0;
    const b = new LocationBatcher(3, 60_000, () => now);
    expect(b.add(pt(1))).toBe(false);
    now = 61_000;
    expect(b.add(pt(2))).toBe(true);
  });
});

function fakeGuardian() {
  const uploads: LocationPointInput[][] = [];
  const sharingCalls: boolean[] = [];
  const service = {
    isConfigured: () => true,
    setSharingEnabled: async (v: boolean) => {
      sharingCalls.push(v);
    },
    uploadLocationPoints: async (points: LocationPointInput[]) => {
      uploads.push(points);
    },
  } as unknown as GuardianService;
  return { service, uploads, sharingCalls };
}

function fakeAdapter(granted = true) {
  let onPoint: ((p: LocationPointInput) => void) | null = null;
  let removed = 0;
  const adapter: LocationAdapter = {
    requestForegroundPermission: async () => granted,
    watchPosition: async (cb) => {
      onPoint = cb;
      const sub: LocationSubscriptionLike = {
        remove: () => {
          removed++;
          onPoint = null;
        },
      };
      return sub;
    },
  };
  return {
    adapter,
    emit: (p: LocationPointInput) => onPoint?.(p),
    removedCount: () => removed,
    watching: () => onPoint !== null,
  };
}

function fakeAppState() {
  let listener: ((s: string) => void) | null = null;
  return {
    appState: {
      currentState: 'active',
      addEventListener: (_t: 'change', l: (s: string) => void) => {
        listener = l;
        return { remove: () => (listener = null) };
      },
    },
    fire: (s: string) => listener?.(s),
  };
}

describe('LocationSharingService', () => {
  it('denied permission: does not start, does not enable sharing server-side', async () => {
    const g = fakeGuardian();
    const a = fakeAdapter(false);
    const svc = new LocationSharingService(g.service, a.adapter, null);
    await expect(svc.start()).resolves.toBe('permission-denied');
    expect(svc.isRunning).toBe(false);
    expect(g.sharingCalls).toEqual([]);
  });

  it('uploads in batches of 3 while running', async () => {
    const g = fakeGuardian();
    const a = fakeAdapter(true);
    const svc = new LocationSharingService(g.service, a.adapter, null);
    await expect(svc.start()).resolves.toBe('started');
    // Deployed contract: starting collection does NOT grant consent —
    // consent changes only via the explicit Family-screen toggles.
    expect(g.sharingCalls).toEqual([]);
    a.emit(pt(1));
    a.emit(pt(2));
    expect(g.uploads).toHaveLength(0);
    a.emit(pt(3));
    await Promise.resolve();
    expect(g.uploads).toHaveLength(1);
    expect(g.uploads[0]).toHaveLength(3);
    await svc.stopWatching();
  });

  it('stops collecting when the app goes to background (foreground-only)', async () => {
    const g = fakeGuardian();
    const a = fakeAdapter(true);
    const as = fakeAppState();
    const svc = new LocationSharingService(g.service, a.adapter, as.appState);
    await svc.start();
    expect(a.watching()).toBe(true);
    as.fire('background');
    expect(a.watching()).toBe(false);
    as.fire('active');
    await Promise.resolve();
    expect(a.watching()).toBe(true);
    await svc.stopWatching();
  });

  it('concurrent start() calls subscribe exactly one watch (race guard)', async () => {
    const g = fakeGuardian();
    const a = fakeAdapter(true);
    let watchCalls = 0;
    const counting: LocationAdapter = {
      ...a.adapter,
      watchPosition: async (...args: Parameters<LocationAdapter['watchPosition']>) => {
        watchCalls++;
        return a.adapter.watchPosition(...args);
      },
    };
    const svc = new LocationSharingService(g.service, counting, null);
    const [r1, r2] = await Promise.all([svc.start(), svc.start()]);
    expect(r1).toBe('started');
    expect(r2).toBe('started');
    expect(watchCalls).toBe(1);
    expect(g.sharingCalls).toEqual([]);
    await svc.stopWatching();
  });

  it('disableSharing stops the watch AND purges via setSharingEnabled(false)', async () => {
    const g = fakeGuardian();
    const a = fakeAdapter(true);
    const svc = new LocationSharingService(g.service, a.adapter, null);
    await svc.start();
    await svc.disableSharing();
    expect(svc.isRunning).toBe(false);
    expect(a.watching()).toBe(false);
    expect(g.sharingCalls).toEqual([false]);
  });
});
