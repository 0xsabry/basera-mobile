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

describe('UpdateService single authoritative flow (OTA audit hardening)', () => {
  it('concurrent checkAndDownload calls share ONE native check + fetch', async () => {
    let releaseCheck!: (v: { isUpdateAvailable: boolean; manifest?: { id?: string } }) => void;
    const check = jest.fn(
      () =>
        new Promise<{ isUpdateAvailable: boolean; manifest?: { id?: string } }>((resolve) => {
          releaseCheck = resolve;
        }),
    );
    const fetch = jest.fn(async () => ({ isNew: true, manifest: { id: 'upd-7' } }));
    const svc = new UpdateService(
      fakeNative({ checkForUpdateAsync: check, fetchUpdateAsync: fetch }),
      () => false,
    );
    const p1 = svc.checkAndDownload();
    const p2 = svc.checkAndDownload();
    const p3 = svc.checkAndDownload();
    expect(svc.isCheckInFlight).toBe(true);
    releaseCheck({ isUpdateAvailable: true, manifest: { id: 'upd-7' } });
    const [s1, s2, s3] = await Promise.all([p1, p2, p3]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s1.phase).toBe('ready');
    expect(s2).toEqual(s1);
    expect(s3).toEqual(s1);
    expect(svc.isCheckInFlight).toBe(false);
  });

  it('a call during the downloading phase joins the in-flight run (fetch never runs twice)', async () => {
    let releaseFetch!: (v: { isNew: boolean; manifest?: { id?: string } }) => void;
    const fetch = jest.fn(
      () =>
        new Promise<{ isNew: boolean; manifest?: { id?: string } }>((resolve) => {
          releaseFetch = resolve;
        }),
    );
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => ({ isUpdateAvailable: true, manifest: { id: 'upd-9' } }),
        fetchUpdateAsync: fetch,
      }),
      () => false,
    );
    const p1 = svc.checkAndDownload();
    // Let the run reach the downloading phase before the second call.
    await new Promise((r) => setImmediate(r));
    expect(svc.getStatus().phase).toBe('downloading');
    const p2 = svc.checkAndDownload();
    releaseFetch({ isNew: true, manifest: { id: 'upd-9' } });
    const [s1, s2] = await Promise.all([p1, p2]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s1.phase).toBe('ready');
    // After a successful download the status reports the staged update id.
    expect(s1.pendingUpdateId).toBe('upd-9');
    expect(s2.pendingUpdateId).toBe('upd-9');
    expect(svc.getStatus().pendingUpdateId).toBe('upd-9');
  });

  it('restartToApply refuses while a check/download is in flight', async () => {
    const reload = jest.fn(async () => undefined);
    let releaseFetch!: (v: { isNew: boolean; manifest?: { id?: string } }) => void;
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => ({ isUpdateAvailable: true }),
        fetchUpdateAsync: () =>
          new Promise<{ isNew: boolean; manifest?: { id?: string } }>((resolve) => {
            releaseFetch = resolve;
          }),
        reloadAsync: reload,
      }),
      () => false,
    );
    const run = svc.checkAndDownload();
    await new Promise((r) => setImmediate(r));
    expect(svc.getStatus().phase).toBe('downloading');
    const refused = await svc.restartToApply();
    expect(refused).toEqual({ applied: false, reason: 'in-progress' });
    expect(reload).not.toHaveBeenCalled();
    releaseFetch({ isNew: true, manifest: { id: 'upd-11' } });
    await run;
    // Once the download settled, the safe restart path works again.
    const applied = await svc.restartToApply();
    expect(applied).toEqual({ applied: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('OTA native auto-check configuration (audit)', () => {
  it('app.json checkAutomatically is ON_ERROR_RECOVERY (native layer never competes on normal launches)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path') as typeof import('path');
    const appJson = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'app.json'), 'utf8')) as {
      expo: { updates?: { checkAutomatically?: string } };
    };
    expect(appJson.expo.updates?.checkAutomatically).toBe('ON_ERROR_RECOVERY');
  });
});

describe('launch check + in-app surfacing (wiring guards)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path') as typeof import('path');
  const layout = readFileSync(join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
  const settings = readFileSync(join(__dirname, '..', '..', 'app', '(tabs)', 'settings.tsx'), 'utf8');
  const updates = readFileSync(join(__dirname, '..', '..', 'app', 'updates.tsx'), 'utf8');

  it('the root layout checks for updates on app launch', () => {
    expect(layout).toContain("from '../update/UpdateService'");
    // The check runs in an effect (mount), not behind a user action.
    expect(layout).toMatch(/useEffect\(\(\) => \{\s*void updateService\.checkAndDownload\(\);\s*\}, \[\]\);/);
  });

  it('the launch path never applies/reloads directly (safe path only)', () => {
    // restartToApply must stay exclusive to the Updates screen's
    // explicit, busy-guarded button.
    expect(layout).not.toContain('restartToApply');
    expect(updates).toContain('restartToApply');
  });

  it('Settings surfaces the live update state (subscribed, update-ready visible)', () => {
    expect(settings).toContain('updateService.subscribe');
    expect(settings).toContain("updateStatus.phase === 'ready'");
    expect(settings).toContain("t(lang, 'updateReady')");
  });
});
