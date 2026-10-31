/**
 * UpdateService CONTRACT tests — written against the expo-updates
 * SDK's own documented result shapes, not against the service's
 * assumptions.
 *
 * Why this file exists (the OTA killer bug, found 2026-11-01): the
 * service's native facade declared the check result as
 * `{ isUpdateAvailable: boolean }` and read that field. SDK 58's real
 * `UpdateCheckResult` (node_modules/expo-updates/build/
 * Updates.types.d.ts) names the field `isAvailable`. The read was
 * therefore always `undefined` on every real device, every check
 * concluded "no update available", and OTA delivery was dead while
 * the unit suite stayed green — because the mocks in
 * updateService.test.ts encoded the same wrong shape. Those mocks are
 * fixed; this suite pins the contract so the lie cannot return:
 *
 *  - behavior tests drive the service with the SDK-documented shapes
 *    (and ONLY those shapes),
 *  - a decoy test proves the service follows `isAvailable` even when
 *    a stale wrong-named field rides along with the opposite value,
 *  - a static guard bans the wrong field name from all of src (this
 *    file is the single allowlisted exception, because it must name
 *    the field to guard against it and to build the decoy),
 *  - the rollback directive shape is covered end to end: it is the
 *    server's emergency brake and must stage + apply like an update.
 *
 * Note on the guard: `isUpdateAvailableAsync` is NOT part of SDK 58's
 * check API (the only check entry point is `checkForUpdateAsync`,
 * returning `isAvailable`-shaped results) and is referenced nowhere in
 * src. If a future SDK legitimately exposes that name, add the
 * referencing file to GUARD_ALLOWLIST below WITH a justification —
 * never weaken the guard silently.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

import type { UpdateCheckResultNotAvailableReason } from 'expo-updates';

import {
  UpdateService,
  type UpdateCheckResult,
  type UpdateFetchResult,
  type UpdatesFacadeMatchesSdk,
  type UpdatesNativeModule,
} from '../UpdateService';

/** The service file's compile-time tripwire, referenced so this suite
 *  documents it: if the installed SDK module ever stops satisfying the
 *  facade, `tsc` fails in UpdateService.ts itself. */
const SDK_CONTRACT_HOLDS: UpdatesFacadeMatchesSdk = true;

/* ----- SDK-documented shapes (Updates.types.d.ts) ----- */

const CHECK_AVAILABLE: UpdateCheckResult = {
  isAvailable: true,
  manifest: { id: 'contract-upd-1' },
  isRollBackToEmbedded: false,
};

const CHECK_NOT_AVAILABLE: UpdateCheckResult = {
  isAvailable: false,
  manifest: undefined,
  isRollBackToEmbedded: false,
  reason: 'noUpdateAvailableOnServer' as UpdateCheckResultNotAvailableReason,
};

const CHECK_ROLLBACK: UpdateCheckResult = {
  isAvailable: false,
  manifest: undefined,
  isRollBackToEmbedded: true,
};

const FETCH_NEW: UpdateFetchResult = {
  isNew: true,
  manifest: { id: 'contract-upd-1' },
  isRollBackToEmbedded: false,
};

const FETCH_ROLLBACK: UpdateFetchResult = {
  isNew: false,
  manifest: undefined,
  isRollBackToEmbedded: true,
};

function fakeNative(overrides: Partial<UpdatesNativeModule> = {}): UpdatesNativeModule {
  return {
    isEnabled: true,
    updateId: 'embedded-id',
    channel: 'preview',
    runtimeVersion: '1.1.0',
    isEmbeddedLaunch: true,
    checkForUpdateAsync: async () => CHECK_NOT_AVAILABLE,
    fetchUpdateAsync: async () => FETCH_NEW,
    reloadAsync: async () => undefined,
    ...overrides,
  };
}

describe('contract: SDK-documented check shapes drive the service', () => {
  it('the compile-time SDK contract assertion holds', () => {
    expect(SDK_CONTRACT_HOLDS).toBe(true);
  });

  it('{ isAvailable: true, manifest } -> fetches and stages the update (ready)', async () => {
    const fetch = jest.fn(async () => FETCH_NEW);
    const reload = jest.fn(async () => undefined);
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => CHECK_AVAILABLE,
        fetchUpdateAsync: fetch,
        reloadAsync: reload,
      }),
      () => false,
    );
    const s = await svc.checkAndDownload();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.phase).toBe('ready');
    expect(s.pendingUpdateId).toBe('contract-upd-1');
    expect(reload).not.toHaveBeenCalled();
  });

  it('{ isAvailable: false, reason } -> up to date; fetch is never called', async () => {
    const fetch = jest.fn(async () => FETCH_NEW);
    const svc = new UpdateService(
      fakeNative({ checkForUpdateAsync: async () => CHECK_NOT_AVAILABLE, fetchUpdateAsync: fetch }),
      () => false,
    );
    const s = await svc.checkAndDownload();
    expect(fetch).not.toHaveBeenCalled();
    expect(s.phase).toBe('idle');
    expect(s.pendingUpdateId).toBeNull();
    expect(s.lastCheckAt).not.toBeNull();
  });

  it('available check + failed fetch shape -> nothing staged (idle)', async () => {
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => CHECK_AVAILABLE,
        fetchUpdateAsync: async () => ({
          isNew: false,
          manifest: undefined,
          isRollBackToEmbedded: false,
        }),
      }),
      () => false,
    );
    const s = await svc.checkAndDownload();
    expect(s.phase).toBe('idle');
    expect(s.pendingUpdateId).toBeNull();
  });
});

describe('contract: the service reads isAvailable — and only isAvailable', () => {
  /** A result object that ALSO carries the stale wrong-named field
   *  with the OPPOSITE value, as a leftover-shaped payload would. The
   *  documented field must win. */
  const withDecoy = (real: UpdateCheckResult, decoy: boolean): UpdateCheckResult =>
    ({ ...real, isUpdateAvailable: decoy }) as unknown as UpdateCheckResult;

  it('isAvailable: true wins over a false decoy -> update is fetched', async () => {
    const fetch = jest.fn(async () => FETCH_NEW);
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => withDecoy(CHECK_AVAILABLE, false),
        fetchUpdateAsync: fetch,
      }),
      () => false,
    );
    const s = await svc.checkAndDownload();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.phase).toBe('ready');
  });

  it('isAvailable: false wins over a true decoy -> no fetch, up to date', async () => {
    const fetch = jest.fn(async () => FETCH_NEW);
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => withDecoy(CHECK_NOT_AVAILABLE, true),
        fetchUpdateAsync: fetch,
      }),
      () => false,
    );
    const s = await svc.checkAndDownload();
    expect(fetch).not.toHaveBeenCalled();
    expect(s.phase).toBe('idle');
  });
});

describe('contract: rollback directive (the server emergency brake)', () => {
  it('rollback check -> staged via fetch, reported ready as rollback-to-embedded', async () => {
    const fetch = jest.fn(async () => FETCH_ROLLBACK);
    const svc = new UpdateService(
      fakeNative({ checkForUpdateAsync: async () => CHECK_ROLLBACK, fetchUpdateAsync: fetch }),
      () => false,
    );
    const s = await svc.checkAndDownload();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.phase).toBe('ready');
    expect(s.pendingUpdateId).toBe('rollback-to-embedded');
  });

  it('rollback applies at cold start with zero user steps (exactly one reload)', async () => {
    const reload = jest.fn(async () => undefined);
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => CHECK_ROLLBACK,
        fetchUpdateAsync: async () => FETCH_ROLLBACK,
        reloadAsync: reload,
      }),
      () => false,
    );
    const result = await svc.checkAndApplyOnLaunch();
    expect(result).toEqual({ applied: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a staged rollback still honors the accessibility busy guard', async () => {
    const reload = jest.fn(async () => undefined);
    const svc = new UpdateService(
      fakeNative({
        checkForUpdateAsync: async () => CHECK_ROLLBACK,
        fetchUpdateAsync: async () => FETCH_ROLLBACK,
        reloadAsync: reload,
      }),
      () => true, // accessibility operation in progress
    );
    await svc.checkAndDownload();
    const result = await svc.restartToApply();
    expect(result).toEqual({ applied: false, reason: 'busy' });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('static guard: the wrong field name stays out of src', () => {
  /** Files permitted to contain the forbidden token, with reasons.
   *  This file only: it must name the field to guard against it and
   *  to build the decoy payloads above. Nothing else — production
   *  code must never declare or read the field, in code or comments. */
  const GUARD_ALLOWLIST = new Set([resolve(__filename)]);

  const FORBIDDEN = 'isUpdateAvailable';

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        yield* walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        yield full;
      }
    }
  }

  it('no src file declares or reads the non-existent check-result field', () => {
    const srcRoot = join(__dirname, '..', '..');
    const violations: string[] = [];
    for (const file of walk(srcRoot)) {
      if (GUARD_ALLOWLIST.has(resolve(file))) continue;
      if (readFileSync(file, 'utf8').includes(FORBIDDEN)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
