/**
 * Bug 2: language-switch restart coordination.
 *
 * needsDirectionRestart matrix + LanguageRestartCoordinator behavior
 * with fully injected fakes (no native modules, no timers).
 */
import {
  LanguageRestartCoordinator,
  needsDirectionRestart,
  type LanguageRestartDeps,
} from '../languageRestart';

describe('needsDirectionRestart', () => {
  it('is true only when RTL-ness flips', () => {
    expect(needsDirectionRestart('ar', 'en')).toBe(true);
    expect(needsDirectionRestart('en', 'ar')).toBe(true);
    expect(needsDirectionRestart('ar', 'ar')).toBe(false);
    expect(needsDirectionRestart('en', 'en')).toBe(false);
  });
});

const NOTICE = 'notice-text';
const DEFERRED = 'deferred-text';

function makeHarness(overrides: Partial<LanguageRestartDeps> = {}) {
  let busy = false;
  let canReload = true;
  const listeners = new Set<() => void>();
  const announced: string[] = [];
  let reloadCalls = 0;
  let reloadImpl: () => Promise<void> = async () => undefined;

  const deps: LanguageRestartDeps = {
    isBusy: () => busy,
    subscribeBusy: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    reload: async () => {
      reloadCalls += 1;
      await reloadImpl();
    },
    announce: (msg) => {
      announced.push(msg);
    },
    canReload: () => canReload,
    delay: async () => undefined,
    ...overrides,
  };
  return {
    deps,
    announced,
    get reloadCalls() {
      return reloadCalls;
    },
    get listenerCount() {
      return listeners.size;
    },
    setBusy(v: boolean) {
      busy = v;
      for (const cb of [...listeners]) cb();
    },
    setCanReload(v: boolean) {
      canReload = v;
    },
    setReloadImpl(fn: () => Promise<void>) {
      reloadImpl = fn;
    },
  };
}

/** Let the coordinator's fire-and-forget proceed() chain settle. */
async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('LanguageRestartCoordinator', () => {
  it('idle: announces the notice then reloads exactly once, returns restarted', async () => {
    const h = makeHarness();
    const c = new LanguageRestartCoordinator(h.deps);
    expect(c.requestLanguageChange(NOTICE, DEFERRED)).toBe('restarted');
    expect(h.announced).toEqual([NOTICE]);
    await flush();
    expect(h.reloadCalls).toBe(1);
    expect(c.isPending).toBe(false);
  });

  it('busy: returns deferred, announces deferred text, reloads once when busy clears', async () => {
    const h = makeHarness();
    h.setBusy(true);
    const c = new LanguageRestartCoordinator(h.deps);
    expect(c.requestLanguageChange(NOTICE, DEFERRED)).toBe('deferred');
    expect(h.announced).toEqual([DEFERRED]);
    await flush();
    expect(h.reloadCalls).toBe(0);

    h.setBusy(false);
    expect(h.announced).toEqual([DEFERRED, NOTICE]);
    await flush();
    expect(h.reloadCalls).toBe(1);
    expect(h.listenerCount).toBe(0);

    // Further busy flips must not reload again.
    h.setBusy(true);
    h.setBusy(false);
    await flush();
    expect(h.reloadCalls).toBe(1);
  });

  it('double request while pending is a no-op and still reloads once', async () => {
    const h = makeHarness();
    h.setBusy(true);
    const c = new LanguageRestartCoordinator(h.deps);
    expect(c.requestLanguageChange(NOTICE, DEFERRED)).toBe('deferred');
    expect(c.requestLanguageChange(NOTICE, DEFERRED)).toBe('already-pending');
    expect(h.announced).toEqual([DEFERRED]);
    h.setBusy(false);
    await flush();
    expect(h.reloadCalls).toBe(1);
  });

  it('double request while an idle restart is in flight is already-pending', async () => {
    const h = makeHarness();
    const c = new LanguageRestartCoordinator(h.deps);
    expect(c.requestLanguageChange(NOTICE, DEFERRED)).toBe('restarted');
    expect(c.requestLanguageChange(NOTICE, DEFERRED)).toBe('already-pending');
    await flush();
    expect(h.reloadCalls).toBe(1);
  });

  it('canReload false: unavailable, no announce, no reload, not pending', async () => {
    const h = makeHarness();
    h.setCanReload(false);
    const c = new LanguageRestartCoordinator(h.deps);
    expect(c.requestLanguageChange(NOTICE, DEFERRED)).toBe('unavailable');
    await flush();
    expect(h.announced).toEqual([]);
    expect(h.reloadCalls).toBe(0);
    expect(c.isPending).toBe(false);
  });

  it('reload rejection is swallowed and pending resets (no crash, no loop)', async () => {
    const h = makeHarness();
    h.setReloadImpl(async () => {
      throw new Error('reload failed');
    });
    const c = new LanguageRestartCoordinator(h.deps);
    expect(c.requestLanguageChange(NOTICE, DEFERRED)).toBe('restarted');
    await flush();
    expect(h.reloadCalls).toBe(1);
    expect(c.isPending).toBe(false);
    // A later request is accepted again (exactly one more attempt).
    expect(c.requestLanguageChange(NOTICE, DEFERRED)).toBe('restarted');
    await flush();
    expect(h.reloadCalls).toBe(2);
  });
});
