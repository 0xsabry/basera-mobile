/**
 * Guardian service — DEPLOYED-contract edition (owner's Supabase
 * project, see docs/SUPABASE_INTEGRATION.md). This replaces the earlier
 * local design (pairing RPCs + pending/approve flow + location_points
 * history); wherever the two disagreed, the deployed project wins:
 *
 * - Pairing runs through the Edge Functions `create-guardian-invite`
 *   (wearer) and `accept-guardian-invite` (guardian, { invite_code }).
 *   A successful accept creates an ACTIVE link immediately — the
 *   deployed model has NO owner-approval step, and this client does
 *   not invent one.
 * - Consent is PER-LINK on guardian_links (verified live):
 *   location_sharing_enabled / sos_sharing_enabled sit on each link,
 *   start FALSE at pairing, and only the wearer (subject) can change
 *   them. The service's aggregate consent = "at least one of my links
 *   grants it"; the master toggles fan out to all my links, and
 *   turning location sharing OFF also deletes the stored latest
 *   location. profiles carries NO consent columns (id, display_name,
 *   preferred_language only) and has no signup trigger — sign-in/up
 *   ensures the row client-side.
 * - guardian_locations holds ONLY the latest fix per wearer: uploads
 *   upsert the newest point; the full point history of the old design
 *   no longer exists server-side. The on-device offline queue still
 *   buffers points, but a flush uploads only the newest one.
 * - SOS goes to sos_alerts, gated by the SOS consent flag.
 * - All access is the signed-in user through RLS (anon/publishable key
 *   only). When Supabase is not configured, NotConfiguredGuardianService
 *   reports isConfigured() = false and mutations throw
 *   GuardianNotConfiguredError so screens show the honest
 *   "not configured" state.
 *
 * All table/function names live in supabaseGateway.ts — never here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import * as gw from './supabaseGateway';

export class GuardianNotConfiguredError extends Error {
  constructor() {
    super('Guardian service is not configured yet');
    this.name = 'GuardianNotConfiguredError';
  }
}

export class GuardianServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardianServiceError';
  }
}

/** Pairing failure with a classified kind so the UI can localize it. */
export class GuardianInviteError extends GuardianServiceError {
  constructor(
    readonly kind: gw.InviteErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'GuardianInviteError';
  }
}

export type GuardianLinkStatus = 'pending' | 'active' | 'revoked' | string;

export interface GuardianUser {
  id: string;
  email: string | null;
}

export interface SignUpResult {
  user: GuardianUser | null;
  /** True when email confirmation is required before a session exists
   *  (the deployed project has mailer_autoconfirm=false). */
  needsConfirmation: boolean;
}

export interface GuardianLink {
  id: string;
  ownerId: string;
  guardianId: string;
  /** The deployed model has no status column; a link that exists is
   *  paired. Kept for display compatibility ('paired'). */
  status: GuardianLinkStatus;
  /** Per-link consent (wearer-controlled; both start FALSE). */
  locationSharingEnabled: boolean;
  sosSharingEnabled: boolean;
  createdAt: string | null;
  /** Display name of the OTHER party. */
  otherPartyName: string | null;
}

export interface PairingCode {
  code: string;
  /** From the Edge Function payload; null when it provides none. */
  expiresAt: string | null;
}

export interface LocationPointInput {
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: string; // ISO
}

export interface LatestLocation {
  userId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: string;
  updatedAt: string | null;
}

export type { ConsentState } from './supabaseGateway';

export interface GuardianService {
  isConfigured(): boolean;
  getCurrentUser(): Promise<GuardianUser | null>;
  signIn(email: string, password: string, preferredLanguage?: string): Promise<GuardianUser>;
  signUp(
    email: string,
    password: string,
    displayName?: string,
    preferredLanguage?: string,
  ): Promise<SignUpResult>;
  signOut(): Promise<void>;
  /** Wearer: create an invite via the Edge Function. */
  createPairingCode(): Promise<PairingCode>;
  /** Guardian: accept an invite code — success means the link is
   *  PAIRED immediately (consent flags still start FALSE). */
  redeemPairingCode(code: string): Promise<{ linkId: string | null; status: 'active' }>;
  /** Links where I am the wearer (my guardians). */
  listMyGuardians(): Promise<GuardianLink[]>;
  /** Links where I am the guardian (people sharing with me). */
  listPeopleIGuard(): Promise<GuardianLink[]>;
  /** Unlink: delete the link row (works for either party — RLS decides). */
  revokeLink(linkId: string): Promise<void>;
  /**
   * Master location-sharing consent: sets location_sharing_enabled on
   * ALL of my links (as wearer). Turning it OFF also deletes the
   * stored latest location server-side.
   */
  setSharingEnabled(enabled: boolean): Promise<void>;
  /** Aggregate consent across my links (ON = at least one link grants). */
  getConsent(): Promise<gw.ConsentState>;
  /** Master SOS consent: sets sos_sharing_enabled on ALL of my links. */
  setSosSharingEnabled(enabled: boolean): Promise<void>;
  /** Per-link consent change (wearer only; RLS enforces). */
  setLinkConsent(linkId: string, patch: Partial<gw.ConsentState>): Promise<GuardianLink>;
  /**
   * Upload location points. DEPLOYED semantics: only the NEWEST point is
   * stored (guardian_locations is latest-only) and the upsert happens
   * ONLY while location consent is ON — otherwise this throws.
   */
  uploadLocationPoints(points: LocationPointInput[]): Promise<void>;
  getLatestLocation(userId: string): Promise<LatestLocation | null>;
  /** Insert an SOS alert (caller checks SOS consent first). */
  sendSosAlert(fix: LocationPointInput | null): Promise<void>;
  /** Mark my own active SOS alerts resolved ("I am OK"). */
  resolveMyActiveSos(): Promise<void>;
  /** Register/refresh this device's Expo push token (delivery untested). */
  registerPushToken(token: string): Promise<void>;
  /** Remove this user's push token rows (sign-out cleanup). */
  removeMyPushTokens(): Promise<void>;
  /**
   * Delete the user's DATA rows across the deployed tables. The deployed
   * project exposes no client-callable auth-account deletion, so the
   * account itself is NOT removed by this — the UI states that honestly.
   */
  deleteMyAccountData(): Promise<void>;
  /** Live link changes for the signed-in user (either role). */
  subscribeLinks(onChange: () => void): gw.Subscription | null;
}

function toServiceError(e: unknown): GuardianServiceError {
  if (e instanceof gw.GatewayError) {
    if (
      e.kind === 'invalid-or-expired' ||
      e.kind === 'expired' ||
      e.kind === 'already-used' ||
      e.kind === 'self-pairing' ||
      e.kind === 'invalid' ||
      e.kind === 'network' ||
      e.kind === 'unauthenticated'
    ) {
      return new GuardianInviteError(e.kind, e.message);
    }
    return new GuardianServiceError(e.message);
  }
  return new GuardianServiceError(e instanceof Error ? e.message : 'guardian operation failed');
}

export class SupabaseGuardianService implements GuardianService {
  constructor(private client: SupabaseClient) {}

  isConfigured(): boolean {
    return true;
  }

  async getCurrentUser(): Promise<GuardianUser | null> {
    const { data } = await this.client.auth.getUser();
    if (!data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  }

  private async ensureProfileFor(
    user: { id: string; email?: string | null },
    displayName?: string,
    preferredLanguage?: string,
  ): Promise<void> {
    try {
      await gw.ensureProfile(this.client, { id: user.id, email: user.email ?? null }, {
        displayName,
        preferredLanguage,
      });
    } catch {
      // Profile creation must not block a successful sign-in: the row
      // is ensured again on the next sign-in, and nothing in the
      // deployed schema grants access based on a profile existing.
    }
  }

  async signIn(
    email: string,
    password: string,
    preferredLanguage?: string,
  ): Promise<GuardianUser> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new GuardianServiceError(error.message);
    await this.ensureProfileFor(data.user, undefined, preferredLanguage);
    return { id: data.user.id, email: data.user.email ?? null };
  }

  async signUp(
    email: string,
    password: string,
    displayName?: string,
    preferredLanguage?: string,
  ): Promise<SignUpResult> {
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw new GuardianServiceError(error.message);
    if (!data.user) return { user: null, needsConfirmation: true };
    const user = { id: data.user.id, email: data.user.email ?? null };
    if (data.session) {
      // Session exists immediately: a profile can be created right
      // away under RLS.
      await this.ensureProfileFor(data.user, displayName, preferredLanguage);
      return { user, needsConfirmation: false };
    }
    // Email confirmation required (deployed setting): no session yet,
    // so no RLS-authenticated write is possible. The profile is created
    // idempotently at first sign-in instead.
    return { user, needsConfirmation: true };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) throw new GuardianServiceError(error.message);
  }

  private async requireUserId(): Promise<string> {
    const user = await this.getCurrentUser();
    if (!user) throw new GuardianServiceError('not signed in');
    return user.id;
  }

  async createPairingCode(): Promise<PairingCode> {
    await this.requireUserId();
    try {
      const invite = await gw.createInvite(this.client);
      return { code: invite.code, expiresAt: invite.expiresAt };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async redeemPairingCode(
    code: string,
  ): Promise<{ linkId: string | null; status: 'active' }> {
    await this.requireUserId();
    try {
      const res = await gw.acceptInvite(this.client, code);
      return { linkId: res.linkId, status: 'active' };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  private async withNames(
    links: gw.LinkInfo[],
    otherParty: (l: gw.LinkInfo) => string,
  ): Promise<GuardianLink[]> {
    const names = await gw
      .fetchDisplayNames(
        this.client,
        links.map(otherParty),
      )
      .catch(() => new Map<string, string | null>());
    return links.map((l) => ({
      id: l.id,
      ownerId: l.ownerId,
      guardianId: l.guardianId,
      status: 'paired',
      locationSharingEnabled: l.locationSharingEnabled,
      sosSharingEnabled: l.sosSharingEnabled,
      createdAt: l.createdAt,
      otherPartyName: names.get(otherParty(l)) ?? null,
    }));
  }

  async listMyGuardians(): Promise<GuardianLink[]> {
    const uid = await this.requireUserId();
    try {
      const links = await gw.listLinksAsOwner(this.client, uid);
      return this.withNames(links, (l) => l.guardianId);
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async listPeopleIGuard(): Promise<GuardianLink[]> {
    const uid = await this.requireUserId();
    try {
      const links = await gw.listLinksAsGuardian(this.client, uid);
      return this.withNames(links, (l) => l.ownerId);
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async revokeLink(linkId: string): Promise<void> {
    try {
      await gw.deleteLink(this.client, linkId);
    } catch (e) {
      throw toServiceError(e);
    }
  }

  /** Fan a consent value out to every link where I am the wearer. */
  private async setConsentOnAllMyLinks(patch: Partial<gw.ConsentState>): Promise<void> {
    const uid = await this.requireUserId();
    const links = await gw.listLinksAsOwner(this.client, uid);
    for (const link of links) {
      const needsLocation =
        patch.locationSharingEnabled !== undefined &&
        link.locationSharingEnabled !== patch.locationSharingEnabled;
      const needsSos =
        patch.sosSharingEnabled !== undefined &&
        link.sosSharingEnabled !== patch.sosSharingEnabled;
      if (needsLocation || needsSos) {
        await gw.setLinkConsent(this.client, link.id, patch);
      }
    }
  }

  async setSharingEnabled(enabled: boolean): Promise<void> {
    const uid = await this.requireUserId();
    try {
      await this.setConsentOnAllMyLinks({ locationSharingEnabled: enabled });
      if (!enabled) {
        // Privacy contract: consent off => the stored latest location
        // is deleted, not merely hidden (guardian reads are flag-gated
        // server-side too, but deletion is the stronger guarantee).
        await gw.deleteLatestLocation(this.client, uid);
      }
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async getConsent(): Promise<gw.ConsentState> {
    const uid = await this.requireUserId();
    try {
      const links = await gw.listLinksAsOwner(this.client, uid);
      return gw.aggregateConsent(links);
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async setSosSharingEnabled(enabled: boolean): Promise<void> {
    try {
      await this.setConsentOnAllMyLinks({ sosSharingEnabled: enabled });
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async setLinkConsent(
    linkId: string,
    patch: Partial<gw.ConsentState>,
  ): Promise<GuardianLink> {
    try {
      const updated = await gw.setLinkConsent(this.client, linkId, patch);
      const names = await gw
        .fetchDisplayNames(this.client, [updated.guardianId])
        .catch(() => new Map<string, string | null>());
      return {
        id: updated.id,
        ownerId: updated.ownerId,
        guardianId: updated.guardianId,
        status: 'paired',
        locationSharingEnabled: updated.locationSharingEnabled,
        sosSharingEnabled: updated.sosSharingEnabled,
        createdAt: updated.createdAt,
        otherPartyName: names.get(updated.guardianId) ?? null,
      };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async uploadLocationPoints(points: LocationPointInput[]): Promise<void> {
    if (points.length === 0) return;
    const uid = await this.requireUserId();
    try {
      const consent = await this.getConsent();
      if (!consent.locationSharingEnabled) {
        throw new GuardianServiceError('location sharing consent is off');
      }
      const newest = points[points.length - 1];
      await gw.upsertLatestLocation(this.client, uid, newest);
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async getLatestLocation(userId: string): Promise<LatestLocation | null> {
    try {
      const row = await gw.getLatestLocation(this.client, userId);
      if (!row) return null;
      return {
        userId: row.userId,
        lat: row.lat,
        lng: row.lng,
        accuracyM: row.accuracyM,
        recordedAt: row.recordedAt,
        updatedAt: row.updatedAt,
      };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async sendSosAlert(fix: LocationPointInput | null): Promise<void> {
    const uid = await this.requireUserId();
    try {
      await gw.insertSosAlert(this.client, uid, fix);
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async resolveMyActiveSos(): Promise<void> {
    const uid = await this.requireUserId();
    try {
      await gw.resolveOwnActiveSosAlerts(this.client, uid);
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async registerPushToken(token: string): Promise<void> {
    const uid = await this.requireUserId();
    try {
      await gw.registerPushToken(this.client, uid, token, 'android');
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async removeMyPushTokens(): Promise<void> {
    const user = await this.getCurrentUser();
    if (!user) return;
    try {
      await gw.removePushTokens(this.client, user.id);
    } catch (e) {
      throw toServiceError(e);
    }
  }

  async deleteMyAccountData(): Promise<void> {
    const uid = await this.requireUserId();
    try {
      await gw.deleteAllUserData(this.client, uid);
    } catch (e) {
      throw toServiceError(e);
    }
  }

  subscribeLinks(onChange: () => void): gw.Subscription | null {
    // The channel filter needs the user id; resolve it from the current
    // session and hand back a handle that unsubscribes once ready.
    let inner: gw.Subscription | null = null;
    let cancelled = false;
    void this.getCurrentUser().then((user) => {
      if (user && !cancelled) {
        inner = gw.subscribeUserLinks(this.client, user.id, onChange);
      }
    });
    return {
      unsubscribe: async () => {
        cancelled = true;
        await inner?.unsubscribe();
      },
    };
  }
}

export class NotConfiguredGuardianService implements GuardianService {
  isConfigured(): boolean {
    return false;
  }
  async getCurrentUser(): Promise<GuardianUser | null> {
    return null;
  }
  async signIn(_email: string, _password: string): Promise<GuardianUser> {
    throw new GuardianNotConfiguredError();
  }
  async signUp(
    _email: string,
    _password: string,
    _displayName?: string,
    _preferredLanguage?: string,
  ): Promise<SignUpResult> {
    throw new GuardianNotConfiguredError();
  }
  async signOut(): Promise<void> {
    throw new GuardianNotConfiguredError();
  }
  async createPairingCode(): Promise<PairingCode> {
    throw new GuardianNotConfiguredError();
  }
  async redeemPairingCode(
    _code: string,
  ): Promise<{ linkId: string | null; status: 'active' }> {
    throw new GuardianNotConfiguredError();
  }
  async listMyGuardians(): Promise<GuardianLink[]> {
    return [];
  }
  async listPeopleIGuard(): Promise<GuardianLink[]> {
    return [];
  }
  async revokeLink(_linkId: string): Promise<void> {
    throw new GuardianNotConfiguredError();
  }
  async setSharingEnabled(_enabled: boolean): Promise<void> {
    throw new GuardianNotConfiguredError();
  }
  async getConsent(): Promise<gw.ConsentState> {
    return { locationSharingEnabled: false, sosSharingEnabled: false };
  }
  async setSosSharingEnabled(_enabled: boolean): Promise<void> {
    throw new GuardianNotConfiguredError();
  }
  async setLinkConsent(
    _linkId: string,
    _patch: Partial<gw.ConsentState>,
  ): Promise<GuardianLink> {
    throw new GuardianNotConfiguredError();
  }
  async resolveMyActiveSos(): Promise<void> {
    throw new GuardianNotConfiguredError();
  }
  async uploadLocationPoints(_points: LocationPointInput[]): Promise<void> {
    throw new GuardianNotConfiguredError();
  }
  async getLatestLocation(_userId: string): Promise<LatestLocation | null> {
    return null;
  }
  async sendSosAlert(_fix: LocationPointInput | null): Promise<void> {
    throw new GuardianNotConfiguredError();
  }
  async registerPushToken(_token: string): Promise<void> {
    throw new GuardianNotConfiguredError();
  }
  async removeMyPushTokens(): Promise<void> {
    return;
  }
  async deleteMyAccountData(): Promise<void> {
    throw new GuardianNotConfiguredError();
  }
  subscribeLinks(_onChange: () => void): gw.Subscription | null {
    return null;
  }
}

let cachedService: GuardianService | undefined;

/** App-wide singleton: Supabase-backed when configured, honest stub otherwise. */
export function getGuardianService(): GuardianService {
  if (cachedService) return cachedService;
  const client = getSupabaseClient();
  cachedService = client ? new SupabaseGuardianService(client) : new NotConfiguredGuardianService();
  return cachedService;
}

/** Test helper. */
export function resetGuardianServiceCache(): void {
  cachedService = undefined;
}
