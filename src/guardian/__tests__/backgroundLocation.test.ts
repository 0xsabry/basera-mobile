/**
 * Background location suite: offline queue FIFO/cap, sharing-state
 * derivation from real signals, background service option building +
 * permission gating, and the headless batch handler's honesty rules
 * (upload on success only; queue — never drop, never fake — otherwise).
 */
import {
  BackgroundLocationService,
  buildBackgroundOptions,
  type BackgroundLocationAdapter,
  type BackgroundLocationOptions,
} from '../BackgroundLocationService';
import { OfflineLocationQueue } from '../OfflineLocationQueue';
import type { LocationPointInput } from '../GuardianService';
import { handleLocationBatch } from '../backgroundTaskHandler';
import { deriveSharingState, type SharingSignals } from '../sharingState';

function memoryStorage() {
  let value: string | null = null;
  return {
    getItem: async () => value,
    setItem: async (_k: string, v: string) => {
      value = v;
    },
  };
}

const pt = (lat: number): LocationPointInput => ({
  lat, lng: 31, accuracyM: 10, recordedAt: new Date(lat).toISOString(),
});

describe('OfflineLocationQueue', () => {
  it('FIFO drain + cap drops oldest', async () => {
    const q = new OfflineLocationQueue(memoryStorage(), 3);
    await q.enqueue([pt(1), pt(2)]);
    await q.enqueue([pt(3), pt(4)]);
    expect((await q.list()).map((p) => p.lat)).toEqual([2, 3, 4]);
    const drained = await q.drain(2);
    expect(drained.map((p) => p.lat)).toEqual([2, 3]);
    expect(await q.count()).toBe(1);
    await q.clear();
    expect(await q.count()).toBe(0);
  });
});

describe('deriveSharingState', () => {
  const base: SharingSignals = {
    sharingOn: true, servicesEnabled: true, foregroundGranted: true,
    backgroundStarted: false, offlineQueueLength: 0, configured: true, lastUploadAt: 5,
  };
  it('maps signals honestly', () => {
    expect(deriveSharingState({ ...base, sharingOn: false })).toBe('off');
    expect(deriveSharingState({ ...base, servicesEnabled: false })).toBe('gps-unavailable');
    expect(deriveSharingState({ ...base, foregroundGranted: false })).toBe('permission-denied');
    expect(deriveSharingState({ ...base, backgroundStarted: true, offlineQueueLength: 3 })).toBe('offline-queueing');
    expect(deriveSharingState({ ...base, backgroundStarted: true })).toBe('background-active');
    expect(deriveSharingState({ ...base, lastUploadAt: null })).toBe('sync-pending');
    expect(deriveSharingState(base)).toBe('foreground-only');
    // Unconfigured backend never claims sync-pending.
    expect(deriveSharingState({ ...base, configured: false, lastUploadAt: null })).toBe('foreground-only');
  });
});

class FakeBgAdapter implements BackgroundLocationAdapter {
  bgGranted = true;
  fgGranted = true;
  started = false;
  lastOptions: BackgroundLocationOptions | null = null;
  async requestBackgroundPermission() { return this.bgGranted; }
  async getBackgroundPermission() { return this.bgGranted; }
  async getForegroundPermission() { return this.fgGranted; }
  async servicesEnabled() { return true; }
  async start(_t: string, o: BackgroundLocationOptions) { this.started = true; this.lastOptions = o; }
  async stop() { this.started = false; }
  async hasStarted() { return this.started; }
  balancedAccuracy() { return 3; }
}

describe('BackgroundLocationService', () => {
  it('builds spec options: Balanced, 60s/50m, deferred batching, localized FG-service notification', () => {
    const o = buildBackgroundOptions('ar', 3);
    expect(o.accuracy).toBe(3);
    expect(o.timeInterval).toBe(60_000);
    expect(o.distanceInterval).toBe(50);
    expect(o.deferredUpdatesDistance).toBe(500);
    expect(o.deferredUpdatesTimeout).toBe(300_000);
    expect(o.foregroundService.notificationTitle).toContain('بصيرة');
    expect(o.foregroundService.notificationBody.length).toBeGreaterThan(10);
  });

  it('refuses to start without background permission; starts and stops with it', async () => {
    const adapter = new FakeBgAdapter();
    const svc = new BackgroundLocationService(adapter);
    adapter.bgGranted = false;
    expect(await svc.startBackgroundUpdates('en')).toBe('permission-denied');
    expect(adapter.started).toBe(false);
    adapter.bgGranted = true;
    expect(await svc.startBackgroundUpdates('en')).toBe('started');
    expect(adapter.lastOptions?.timeInterval).toBe(60_000);
    expect(await svc.startBackgroundUpdates('en')).toBe('already-started');
    await svc.stopBackgroundUpdates();
    expect(adapter.started).toBe(false);
  });
});

describe('handleLocationBatch — honesty rules', () => {
  const points = [pt(1), pt(2)];
  function deps(over: Partial<Parameters<typeof handleLocationBatch>[1]> = {}) {
    return {
      uploadsAvailable: async () => true,
      upload: jest.fn(async () => undefined),
      enqueueOffline: jest.fn(async () => undefined),
      recordUploadSuccess: jest.fn(async () => undefined),
      now: () => 42,
      ...over,
    };
  }

  it('uploads and records confirmed success', async () => {
    const d = deps();
    const r = await handleLocationBatch(points, d);
    expect(r).toEqual({ received: 2, uploaded: 2, queued: 0 });
    expect(d.upload).toHaveBeenCalledWith(points);
    expect(d.recordUploadSuccess).toHaveBeenCalledWith(42);
    expect(d.enqueueOffline).not.toHaveBeenCalled();
  });

  it('queues when uploads are unavailable (unconfigured/signed out)', async () => {
    const d = deps({ uploadsAvailable: async () => false });
    const r = await handleLocationBatch(points, d);
    expect(r).toEqual({ received: 2, uploaded: 0, queued: 2 });
    expect(d.upload).not.toHaveBeenCalled();
    expect(d.recordUploadSuccess).not.toHaveBeenCalled();
  });

  it('queues when the upload throws — points are never dropped or faked sent', async () => {
    const d = deps({
      upload: jest.fn(async () => {
        throw new Error('offline');
      }),
    });
    const r = await handleLocationBatch(points, d);
    expect(r.queued).toBe(2);
    expect(d.recordUploadSuccess).not.toHaveBeenCalled();
  });

  it('empty batch is a no-op', async () => {
    const d = deps();
    expect(await handleLocationBatch([], d)).toEqual({ received: 0, uploaded: 0, queued: 0 });
  });
});
