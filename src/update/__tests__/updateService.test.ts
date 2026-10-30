/**
 * UpdateService tests (Phase 0): the native expo-updates module is
 * injected as a fake so the safety contract is testable in Node:
 * downloads never reload; reload is blocked while accessibility is busy;
 * unavailable builds report honestly.
 */
import { UpdateService, type UpdatesNativeModule } from '../UpdateService';

function fakeNative(overrides: Partial<UpdatesNativeModule> = {}): UpdatesNativeModule {
  return {
    isEnabled: true,
    updateId: 'embedded-id',
    channel: 'preview',
    runtimeVersion: '1.1.0',
    isEmbeddedLaunch: true,
    checkForUpdateAsync: async () => ({ isUpdateAvailable: false }),
    fetchUpdateAsync: async () => ({ isNew: false }),
    reloadAsync: async () => undefined,
    ...overrides,
  };
}

describe('UpdateService status mapping', () => {
  it('maps native fields into status', () => {
    const svc = new UpdateService(fakeNative());
    const s = svc.getStatus();
    expect(s.available).toBe(true);
    expect(s.channel).toBe('preview');
    expect(s.runtimeVersion).toBe('1.1.0');
    expect(s.currentUpdateId).toBe('embedded-id');
    expect(s.isEmbeddedLaunch).toBe(true);
    expect(s.phase).toBe('idle');
  });

  it('reports unavailable when the native module is missing (1.0.0 build / Expo Go)', () => {
    const svc = new UpdateService(null);
    const s = svc.getStatus();
    expect(s.available).toBe(false);
    expect(s.phase).toBe('unavailable');
  });

  it('reports unavailable when updates are disabled natively', () => {
    const svc = new UpdateService(fakeNative({ isEnabled: false }));
    expect(svc.getStatus().available).toBe(false);
    expect(svc.getStatus().phase).toBe('unavailable');
  });
});

describe('UpdateService checkAndDownload', () => {
  it('up-to-date: stays idle and records the check time', async () => {
    const svc = new UpdateService(fakeNative());
    const s = await svc.checkAndDownload();
    expect(s.phase).toBe('idle');
    expect(s.lastCheckAt).not.toBeNull();
    expect(s.pendingUpdateId).toBeNull();
  });

  it('downloads an available update WITHOUT reloading', async () => {
    const reload = jest.fn(async () => undefined);
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => ({ isUpdateAvailable: true, manifest: { id: 'upd-42' } }),
        fetchUpdateAsync: async () => ({ isNew: true, manifest: { id: 'upd-42' } }),
        reloadAsync: reload,
      }),
    );
    const s = await svc.checkAndDownload();
    expect(s.phase).toBe('ready');
    expect(s.pendingUpdateId).toBe('upd-42');
    expect(reload).not.toHaveBeenCalled();
  });

  it('check failure -> error phase, no reload, no crash', async () => {
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => {
          throw new Error('network down');
        },
      }),
    );
    const s = await svc.checkAndDownload();
    expect(s.phase).toBe('error');
    expect(s.error).toContain('network down');
  });
});

describe('UpdateService restartToApply (the only reload path)', () => {
  it('blocked while accessibility is busy', async () => {
    const reload = jest.fn(async () => undefined);
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => ({ isUpdateAvailable: true }),
        fetchUpdateAsync: async () => ({ isNew: true, manifest: { id: 'u1' } }),
        reloadAsync: reload,
      }),
      () => true, // busy guard: speech/processing in progress
    );
    await svc.checkAndDownload();
    const result = await svc.restartToApply();
    expect(result).toEqual({ applied: false, reason: 'busy' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('applies when idle and an update is downloaded', async () => {
    const reload = jest.fn(async () => undefined);
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => ({ isUpdateAvailable: true }),
        fetchUpdateAsync: async () => ({ isNew: true, manifest: { id: 'u1' } }),
        reloadAsync: reload,
      }),
      () => false,
    );
    await svc.checkAndDownload();
    const result = await svc.restartToApply();
    expect(result).toEqual({ applied: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('refuses when nothing was downloaded', async () => {
    const reload = jest.fn(async () => undefined);
    const svc = new UpdateService(fakeNative({ reloadAsync: reload }), () => false);
    const result = await svc.restartToApply();
    expect(result).toEqual({ applied: false, reason: 'no-update' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('refuses when unavailable', async () => {
    const svc = new UpdateService(null, () => false);
    const result = await svc.restartToApply();
    expect(result).toEqual({ applied: false, reason: 'unavailable' });
  });
});
