/**
 * PushTokenService tests — REGISTRATION only. Nothing here (or anywhere
 * in the app) claims push DELIVERY works; delivery is untested until a
 * real send is observed on a device.
 */
import { PushTokenService } from '../PushTokenService';
import type { GuardianService } from '../GuardianService';

function fakeGuardian(signedIn = true) {
  const calls: string[] = [];
  const service = {
    getCurrentUser: async () => (signedIn ? { id: 'me', email: 'me@example.com' } : null),
    registerPushToken: async (token: string) => {
      calls.push(`register:${token}`);
    },
    removeMyPushTokens: async () => {
      calls.push('remove');
    },
  } as unknown as GuardianService;
  return { service, calls };
}

function fakeNotifications(opts?: { granted?: boolean; token?: string }) {
  let listener: ((t: { data: string }) => void) | null = null;
  const mod = {
    getPermissionsAsync: async () => ({ granted: opts?.granted ?? true }),
    getExpoPushTokenAsync: async () => ({ data: opts?.token ?? 'ExponentPushToken[abc]' }),
    addPushTokenListener: (cb: (t: { data: string }) => void) => {
      listener = cb;
      return { remove: () => (listener = null) };
    },
  };
  return {
    mod,
    fireToken: (data: string) => listener?.({ data }),
    hasListener: () => listener !== null,
  };
}

describe('PushTokenService.registerCurrentToken', () => {
  it('registers the Expo token for the signed-in user', async () => {
    const g = fakeGuardian();
    const n = fakeNotifications();
    const svc = new PushTokenService(g.service, n.mod, 'project-1');
    await expect(svc.registerCurrentToken()).resolves.toBe('registered');
    expect(g.calls).toEqual(['register:ExponentPushToken[abc]']);
  });

  it('does NOT register (and never prompts) when permission is not granted', async () => {
    const g = fakeGuardian();
    const n = fakeNotifications({ granted: false });
    const svc = new PushTokenService(g.service, n.mod, 'project-1');
    await expect(svc.registerCurrentToken()).resolves.toBe('permission-not-granted');
    expect(g.calls).toEqual([]);
  });

  it('reports not-signed-in / unavailable honestly', async () => {
    const g = fakeGuardian(false);
    const n = fakeNotifications();
    await expect(new PushTokenService(g.service, n.mod, 'project-1').registerCurrentToken()).resolves.toBe(
      'not-signed-in',
    );
    const g2 = fakeGuardian();
    await expect(new PushTokenService(g2.service, null, 'project-1').registerCurrentToken()).resolves.toBe(
      'unavailable',
    );
    await expect(new PushTokenService(g2.service, n.mod, null).registerCurrentToken()).resolves.toBe(
      'unavailable',
    );
  });

  it('re-registering the same token is a no-op; a rotated token re-registers via the listener', async () => {
    const g = fakeGuardian();
    const n = fakeNotifications();
    const svc = new PushTokenService(g.service, n.mod, 'project-1');
    await svc.registerCurrentToken();
    await svc.registerCurrentToken();
    expect(g.calls).toEqual(['register:ExponentPushToken[abc]']);
    svc.startTokenListener();
    expect(n.hasListener()).toBe(true);
    n.fireToken('ExponentPushToken[rotated]');
    await new Promise((r) => setTimeout(r, 0));
    expect(g.calls).toContain('register:ExponentPushToken[rotated]');
    svc.stopTokenListener();
    expect(n.hasListener()).toBe(false);
  });

  it('unregister removes server rows and stops the listener', async () => {
    const g = fakeGuardian();
    const n = fakeNotifications();
    const svc = new PushTokenService(g.service, n.mod, 'project-1');
    svc.startTokenListener();
    await svc.unregister();
    expect(g.calls).toEqual(['remove']);
    expect(n.hasListener()).toBe(false);
  });
});
