/**
 * Expo push-token REGISTRATION for the deployed `user_push_tokens`
 * table (V1.1 live integration).
 *
 * Inspection result (before this module existed): expo-notifications
 * was used ONLY to display/request the notification PERMISSION in
 * Settings — no token was ever fetched or registered anywhere.
 *
 * Scope, honestly:
 * - This module REGISTERS the current device's Expo push token to the
 *   signed-in user's row (platform 'android-expo') and removes it on
 *   sign-out. Registration is all the client can do: actual DELIVERY
 *   depends on a sender (Edge Function + Expo Push Service) and is
 *   NOT claimed anywhere — it remains untested until a real send is
 *   observed on a device.
 * - Registration never prompts: it proceeds only when the OS
 *   notification permission is ALREADY granted (the prompt stays where
 *   it belongs — the explicit Settings control).
 */
import Constants from 'expo-constants';
import type { GuardianService } from './GuardianService';

export type PushRegistrationStatus =
  | 'registered'
  | 'permission-not-granted'
  | 'not-signed-in'
  | 'unavailable'
  | 'failed';

export interface NotificationsModuleLike {
  getPermissionsAsync(): Promise<{ granted: boolean }>;
  getExpoPushTokenAsync(options: { projectId: string }): Promise<{ data: string }>;
  addPushTokenListener(
    listener: (token: { data: string }) => void,
  ): { remove(): void };
}

function loadNotifications(): NotificationsModuleLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-notifications') as NotificationsModuleLike;
  } catch {
    return null;
  }
}

function easProjectId(): string | null {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    eas?: { projectId?: string };
  };
  return extra.eas?.projectId ?? null;
}

export class PushTokenService {
  private tokenSubscription: { remove(): void } | null = null;
  private lastRegisteredToken: string | null = null;

  constructor(
    private guardian: GuardianService,
    private notifications: NotificationsModuleLike | null = loadNotifications(),
    private projectId: string | null = easProjectId(),
  ) {}

  /**
   * Register the current token if (and only if) notification
   * permission is already granted and a user is signed in.
   * Safe to call on sign-in / screen focus: re-registering the same
   * token is a cheap no-op here and a replace server-side.
   */
  async registerCurrentToken(): Promise<PushRegistrationStatus> {
    if (!this.notifications || !this.projectId) return 'unavailable';
    const user = await this.guardian.getCurrentUser().catch(() => null);
    if (!user) return 'not-signed-in';
    try {
      const permission = await this.notifications.getPermissionsAsync();
      if (!permission.granted) return 'permission-not-granted';
      const { data: token } = await this.notifications.getExpoPushTokenAsync({
        projectId: this.projectId,
      });
      if (token !== this.lastRegisteredToken) {
        await this.guardian.registerPushToken(token);
        this.lastRegisteredToken = token;
      }
      return 'registered';
    } catch {
      return 'failed';
    }
  }

  /** Re-register automatically when Expo rotates the token. */
  startTokenListener(): void {
    if (!this.notifications || this.tokenSubscription) return;
    this.tokenSubscription = this.notifications.addPushTokenListener((token) => {
      void (async () => {
        try {
          await this.guardian.registerPushToken(token.data);
          this.lastRegisteredToken = token.data;
        } catch {
          /* next focus-driven registration retries */
        }
      })();
    });
  }

  stopTokenListener(): void {
    this.tokenSubscription?.remove();
    this.tokenSubscription = null;
  }

  /** Sign-out cleanup: drop the server-side rows + the listener. */
  async unregister(): Promise<void> {
    this.stopTokenListener();
    this.lastRegisteredToken = null;
    await this.guardian.removeMyPushTokens().catch(() => undefined);
  }
}

let shared: PushTokenService | undefined;

/** App-wide singleton bound to the app-wide guardian service. */
export function getPushTokenService(guardian: GuardianService): PushTokenService {
  if (!shared) shared = new PushTokenService(guardian);
  return shared;
}

/** Test helper. */
export function resetPushTokenServiceCache(): void {
  shared = undefined;
}
