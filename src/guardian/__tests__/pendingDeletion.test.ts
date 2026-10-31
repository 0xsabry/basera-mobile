/**
 * Offline location-revocation state machine (release gate, Item 2).
 *
 * Proves, with a fake Guardian backend + fake key-value storage:
 * - disabling sharing offline stops local collection/uploads IMMEDIATELY
 *   and persists a pending deletion (server state is NOT claimed deleted);
 * - the obligation survives a simulated restart (new instances, same
 *   storage) and stays pending;
 * - a later successful retry confirms deletion and clears the record;
 * - failures keep it pending and increment attempts — 'confirmed' is
 *   unreachable on every failure path;
 * - re-enabling sharing never drops a pending deletion: it executes
 *   first on that contact, before sharing is switched back on.
 */
import type { GuardianService, LocationPointInput } from '../GuardianService';
import { LocationSharingService, type LocationAdapter } from '../LocationSharingService';
import {
  PendingDeletionManager,
  deletionServerMessageKey,
  DELETION_CONFIRMED_AT_KEY,
  PENDING_DELETION_KEY,
  type KeyValueStorage,
} from '../PendingDeletion';

function fakeStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
  };
}

interface FakeGuardian {
  service: GuardianService;
  calls: string[];
  uploads: LocationPointInput[][];
  setOffline(v: boolean): void;
}

function fakeGuardian(): FakeGuardian {
  const calls: string[] = [];
  const uploads: LocationPointInput[][] = [];
  let offline = false;
  const service = {
    isConfigured: () => true,
    setSharingEnabled: async (v: boolean) => {
      calls.push(`setSharingEnabled(${v})`);
      if (offline) throw new Error('network offline');
    },
    revokeLink: async (id: string) => {
      calls.push(`revokeLink(${id})`);
      if (offline) throw new Error('network offline');
    },
    uploadLocationPoints: async (points: LocationPointInput[]) => {
      if (offline) throw new Error('network offline');
      uploads.push(points);
    },
  } as unknown as GuardianService;
  return {
    service,
    calls,
    uploads,
    setOffline: (v) => {
      offline = v;
    },
  };
}

function fakeAdapter() {
  let onPoint: ((p: LocationPointInput) => void) | null = null;
  const adapter: LocationAdapter = {
    requestForegroundPermission: async () => true,
    watchPosition: async (cb) => {
      onPoint = cb;
      return {
        remove: () => {
          onPoint = null;
        },
      };
    },
  };
  return {
    adapter,
    emit: (p: Partial<LocationPointInput> = {}) =>
      onPoint?.({ lat: 30, lng: 31, accuracyM: 5, recordedAt: '2026-10-30T10:00:00Z', ...p }),
    watching: () => onPoint !== null,
  };
}

const CLOCK = () => new Date('2026-10-30T12:00:00Z');

describe('PendingDeletionManager', () => {
  it('starts as none; nothing to attempt', async () => {
    const g = fakeGuardian();
    const m = new PendingDeletionManager(g.service, fakeStorage(), CLOCK);
    await m.init();
    expect(m.getStatus().state).toBe('none');
    expect(g.calls).toEqual([]);
  });

  it('offline request: persisted BEFORE the attempt, stays pending, attempts counted on retry', async () => {
    const g = fakeGuardian();
    const storage = fakeStorage();
    g.setOffline(true);
    const m = new PendingDeletionManager(g.service, storage, CLOCK);
    const s = await m.requestDeletion('sharing-disabled');
    expect(s.state).toBe('pending');
    expect(s.requestedAt).toBe('2026-10-30T12:00:00.000Z');
    expect(s.attempts).toBe(1);
    const raw = storage.map.get(PENDING_DELETION_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).reason).toBe('sharing-disabled');
    // 'confirmed' unreachable while every attempt fails:
    g.setOffline(true);
    const s2 = await m.attemptDeletion();
    expect(s2.state).toBe('pending');
    expect(s2.attempts).toBe(2);
    expect(s2.confirmedAt).toBeNull();
  });

  it('survives a restart: new manager, same storage -> still pending', async () => {
    const g = fakeGuardian();
    const storage = fakeStorage();
    g.setOffline(true);
    const m1 = new PendingDeletionManager(g.service, storage, CLOCK);
    await m1.requestDeletion('sharing-disabled');
    // Simulated restart. Still offline: init must not confirm anything.
    const m2 = new PendingDeletionManager(g.service, storage, CLOCK);
    const s = await m2.init();
    expect(s.state).toBe('pending');
    expect(s.requestedAt).toBe('2026-10-30T12:00:00.000Z');
    expect(m2.getStatus().confirmedAt).toBeNull();
  });

  it('retry success -> confirmed, record cleared, confirmation timestamp persisted', async () => {
    const g = fakeGuardian();
    const storage = fakeStorage();
    g.setOffline(true);
    const m = new PendingDeletionManager(g.service, storage, CLOCK);
    await m.requestDeletion('sharing-disabled');
    g.setOffline(false);
    const s = await m.attemptDeletion();
    expect(s.state).toBe('confirmed');
    expect(s.confirmedAt).toBe('2026-10-30T12:00:00.000Z');
    expect(storage.map.has(PENDING_DELETION_KEY)).toBe(false);
    expect(storage.map.get(DELETION_CONFIRMED_AT_KEY)).toBe('2026-10-30T12:00:00.000Z');
    expect(g.calls).toContain('setSharingEnabled(false)');
    // And a later restart still reports the (honest) confirmation.
    const m2 = new PendingDeletionManager(g.service, storage, CLOCK);
    const s2 = await m2.init();
    expect(s2.state).toBe('confirmed');
  });

  it('last-guardian-revoked: executor re-drives revoke BEFORE the purge; revoke failure keeps it pending', async () => {
    const g = fakeGuardian();
    const storage = fakeStorage();
    g.setOffline(true);
    const m = new PendingDeletionManager(g.service, storage, CLOCK);
    const s = await m.requestDeletion('last-guardian-revoked', 'link-9');
    expect(s.state).toBe('pending');
    expect(g.calls).toEqual(['revokeLink(link-9)']); // purge never reached
    g.setOffline(false);
    const s2 = await m.attemptDeletion();
    expect(s2.state).toBe('confirmed');
    expect(g.calls.slice(-2)).toEqual(['revokeLink(link-9)', 'setSharingEnabled(false)']);
  });

  it('a second request never drops the first obligation (earliest time wins)', async () => {
    const g = fakeGuardian();
    const storage = fakeStorage();
    g.setOffline(true);
    let now = new Date('2026-10-30T12:00:00Z');
    const m = new PendingDeletionManager(g.service, storage, () => now);
    await m.requestDeletion('sharing-disabled');
    now = new Date('2026-10-30T13:00:00Z');
    const s = await m.requestDeletion('last-guardian-revoked', 'link-1');
    expect(s.state).toBe('pending');
    expect(s.requestedAt).toBe('2026-10-30T12:00:00.000Z');
    const rec = JSON.parse(storage.map.get(PENDING_DELETION_KEY)!);
    expect(rec.linkId).toBe('link-1');
  });

  it('not-configured backend: deletion waits without consuming attempts', async () => {
    const calls: string[] = [];
    const unconfigured = {
      isConfigured: () => false,
      setSharingEnabled: async () => {
        calls.push('x');
      },
      revokeLink: async () => {
        calls.push('x');
      },
    } as unknown as GuardianService;
    const m = new PendingDeletionManager(unconfigured, fakeStorage(), CLOCK);
    const s = await m.requestDeletion('sharing-disabled');
    expect(s.state).toBe('pending');
    expect(s.attempts).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe('deletion status -> UI copy mapping', () => {
  it('maps the three states to honest server strings', () => {
    expect(
      deletionServerMessageKey({ state: 'none', requestedAt: null, confirmedAt: null, attempts: 0, reason: null }),
    ).toBeNull();
    expect(
      deletionServerMessageKey({
        state: 'pending',
        requestedAt: '2026-10-30T12:00:00.000Z',
        confirmedAt: null,
        attempts: 1,
        reason: 'sharing-disabled',
      }),
    ).toBe('guardianDeletionPending');
    expect(
      deletionServerMessageKey({
        state: 'confirmed',
        requestedAt: '2026-10-30T12:00:00.000Z',
        confirmedAt: '2026-10-30T12:05:00.000Z',
        attempts: 1,
        reason: 'sharing-disabled',
      }),
    ).toBe('guardianDeletionConfirmed');
  });
});

describe('LocationSharingService offline revocation', () => {
  function buildSharing(g: FakeGuardian, storage: KeyValueStorage) {
    const a = fakeAdapter();
    const manager = new PendingDeletionManager(g.service, storage, CLOCK);
    const svc = new LocationSharingService(g.service, a.adapter, null, manager);
    return { svc, a, manager };
  }

  it('offline disable: local collection/uploads stop immediately, deletion pending + persisted', async () => {
    const g = fakeGuardian();
    const storage = fakeStorage();
    const { svc, a } = buildSharing(g, storage);
    await expect(svc.start()).resolves.toBe('started');
    a.emit();
    a.emit(); // 2 buffered points, not yet flushed
    g.setOffline(true);
    await svc.disableSharing();
    expect(svc.isRunning).toBe(false);
    expect(a.watching()).toBe(false);
    expect(svc.deletionStatus.state).toBe('pending');
    expect(storage.map.has(PENDING_DELETION_KEY)).toBe(true);
    // No further uploads are attempted after the local stop:
    const uploadsAtStop = g.uploads.length;
    a.emit();
    await svc.flushBatch();
    expect(g.uploads.length).toBe(uploadsAtStop);
  });

  it('back online: retry via the service confirms deletion', async () => {
    const g = fakeGuardian();
    const storage = fakeStorage();
    const { svc } = buildSharing(g, storage);
    await svc.start();
    g.setOffline(true);
    await svc.disableSharing();
    expect(svc.deletionStatus.state).toBe('pending');
    g.setOffline(false);
    const s = await svc.retryPendingDeletion();
    expect(s.state).toBe('confirmed');
    expect(svc.deletionStatus.state).toBe('confirmed');
    expect(storage.map.has(PENDING_DELETION_KEY)).toBe(false);
  });

  it('re-enabling sharing does NOT drop a pending deletion — it executes first', async () => {
    const g = fakeGuardian();
    const storage = fakeStorage();
    const { svc } = buildSharing(g, storage);
    await svc.start();
    g.setOffline(true);
    await svc.disableSharing();
    expect(svc.deletionStatus.state).toBe('pending');
    // Still offline at re-enable: collection can start locally (the
    // deployed contract keeps consent writes out of start()), but the
    // deletion attempt fails offline and the obligation is NOT dropped
    // by the attempt; it is still persisted and pending.
    await expect(svc.start()).resolves.toBe('started');
    expect(svc.deletionStatus.state).toBe('pending');
    expect(storage.map.has(PENDING_DELETION_KEY)).toBe(true);
    await svc.stopWatching();
    // Online restart: the pending purge executes on this contact.
    g.setOffline(false);
    g.calls.length = 0;
    await expect(svc.start()).resolves.toBe('started');
    expect(g.calls).toEqual(['setSharingEnabled(false)']);
    expect(svc.deletionStatus.state).toBe('confirmed');
  });
});
