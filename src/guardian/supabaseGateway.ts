/**
 * Supabase gateway — the ONE module that knows the DEPLOYED contract of
 * the owner's Supabase project (vbvvwyeccsegfwprwrga). Every table name,
 * column name and Edge Function name used by the guardian features lives
 * here and nowhere else.
 *
 * The contract below was DISCOVERED LIVE on 2026-10-31 with three
 * confirmed test accounts (wearer/guardian/stranger) — see
 * docs/SUPABASE_INTEGRATION.md for the full evidence and
 * scripts/live-rls-test.mjs for the repeatable matrix:
 *
 * - profiles(id, display_name, preferred_language='ar', created_at,
 *   updated_at). NO signup trigger: the client must ensure the row.
 *   NO consent columns here.
 * - guardian_links(id, subject_user_id [the wearer],
 *   guardian_user_id, location_sharing_enabled=false,
 *   sos_sharing_enabled=false, consent_version, accepted_at,
 *   created_at). Consent is PER-LINK and only the SUBJECT (wearer) can
 *   change it (a guardian's update silently affects 0 rows). Either
 *   party can DELETE the link (unlink). Accepting an invite for an
 *   already-paired guardian returns the SAME link id (idempotent).
 * - guardian_locations(subject_user_id PK, latitude, longitude,
 *   accuracy_m, recorded_at [server-set], updated_at). Latest-only.
 *   The wearer can always write/delete their own row; a guardian can
 *   READ it only while their link has location_sharing_enabled=true
 *   (the row's existence alone grants nothing). Strangers see nothing.
 * - sos_alerts(id, subject_user_id, latitude, longitude, accuracy_m,
 *   status='active', message, triggered_at, resolved_at). Wearer
 *   inserts; guardians READ only while sos_sharing_enabled=true on
 *   their link; updates are wearer-only (a guardian cannot resolve);
 *   clients CANNOT delete alerts (no delete policy — safety log).
 * - user_push_tokens(id, user_id, expo_push_token, platform
 *   ['android' verified], created_at, updated_at).
 * - Edge Functions (user JWT required; apikey-only is rejected):
 *   create-guardian-invite -> { invite_code (dashed hex), expires_at }
 *   (~15 min); accept-guardian-invite { invite_code } ->
 *   { link_id, status: 'paired' }. Invalid / expired / reused /
 *   self-pairing all fail with {"error":"invalid_or_expired_invite"}.
 *
 * All access goes through the signed-in user's JWT — RLS is the only
 * authorization layer; nothing here bypasses it and no secret key
 * exists in client code.
 */

export const DEPLOYED = {
  tables: {
    profiles: 'profiles',
    links: 'guardian_links',
    locations: 'guardian_locations',
    sosAlerts: 'sos_alerts',
    pushTokens: 'user_push_tokens',
  },
  functions: {
    createInvite: 'create-guardian-invite',
    acceptInvite: 'accept-guardian-invite',
  },
} as const;

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly kind: InviteErrorKind | 'server' | 'network' | 'unknown' = 'unknown',
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

// ---------------------------------------------------------------------------
// Minimal structural client surface (the real SupabaseClient satisfies
// it; tests inject fakes).
// ---------------------------------------------------------------------------

export interface GatewayQueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface GatewayClient {
  from(table: string): any;
  functions: {
    invoke(
      name: string,
      options?: { body?: Record<string, unknown> },
    ): Promise<{ data: unknown; error: unknown }>;
  };
  channel(name: string): any;
  removeChannel(channel: unknown): Promise<unknown>;
}

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Profiles (no consent here — consent is per-link, below)
// ---------------------------------------------------------------------------

export interface ProfileInfo {
  id: string;
  displayName: string | null;
  preferredLanguage: string | null;
}

const PROFILE_SELECT = 'id, display_name, preferred_language';

function parseProfile(row: Row | null | undefined): ProfileInfo | null {
  if (!row || typeof row.id !== 'string') return null;
  return {
    id: row.id,
    displayName: (row.display_name as string | null) ?? null,
    preferredLanguage: (row.preferred_language as string | null) ?? null,
  };
}

async function selectOwnProfile(client: GatewayClient, uid: string): Promise<Row | null> {
  const { data, error } = (await client
    .from(DEPLOYED.tables.profiles)
    .select(PROFILE_SELECT)
    .eq('id', uid)
    .maybeSingle()) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  return (data as Row | null) ?? null;
}

/**
 * Idempotently make sure the signed-in user has a profile row (the
 * deployed project has NO signup trigger). An existing row is returned
 * untouched except that a display name / language is filled in only
 * when the row does not have one yet.
 */
export async function ensureProfile(
  client: GatewayClient,
  user: { id: string; email: string | null },
  options?: { displayName?: string | null; preferredLanguage?: string | null },
): Promise<ProfileInfo> {
  const existing = await selectOwnProfile(client, user.id);
  if (existing) {
    const profile = parseProfile(existing)!;
    const patch: Row = {};
    const wantedName = options?.displayName?.trim();
    if (wantedName && !profile.displayName) patch.display_name = wantedName;
    if (options?.preferredLanguage && !profile.preferredLanguage) {
      patch.preferred_language = options.preferredLanguage;
    }
    if (Object.keys(patch).length > 0) {
      const { error } = (await client
        .from(DEPLOYED.tables.profiles)
        .update(patch)
        .eq('id', user.id)) as GatewayQueryResult;
      if (!error) {
        if (patch.display_name) profile.displayName = patch.display_name as string;
        if (patch.preferred_language) {
          profile.preferredLanguage = patch.preferred_language as string;
        }
      }
    }
    return profile;
  }
  const fallbackName =
    options?.displayName?.trim() || (user.email ? user.email.split('@')[0] : null) || null;
  const row: Row = { id: user.id, display_name: fallbackName };
  if (options?.preferredLanguage) row.preferred_language = options.preferredLanguage;
  const { error } = (await client
    .from(DEPLOYED.tables.profiles)
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true })) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  const created = await selectOwnProfile(client, user.id);
  return (
    parseProfile(created) ?? {
      id: user.id,
      displayName: fallbackName,
      preferredLanguage: options?.preferredLanguage ?? null,
    }
  );
}

// ---------------------------------------------------------------------------
// Pairing via Edge Functions
// ---------------------------------------------------------------------------

export interface Invite {
  code: string;
  /** ISO timestamp from the function payload, when it provides one. */
  expiresAt: string | null;
  /** Recipient the invite is bound to — returned ONLY by the hardened
   *  create-guardian-invite; null with the deployed function. */
  invitedEmail: string | null;
  /** True only when the backend confirmed the code is bound to the
   *  invited email (hardened function). The UI may claim binding
   *  only when this is true. */
  boundToEmail: boolean;
}

function findString(obj: unknown, keys: string[], depth = 0): string | null {
  if (!obj || typeof obj !== 'object' || depth > 3) return null;
  const rec = obj as Row;
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const key of ['data', 'invite', 'result']) {
    const found = findString(rec[key], keys, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Defensive parse of the create-guardian-invite payload. */
export function parseInvitePayload(data: unknown): Invite {
  const code = findString(data, ['invite_code', 'code', 'pairing_code', 'inviteCode']);
  if (!code) {
    throw new GatewayError('Invite response did not include an invite code', 'server');
  }
  const expiresAt = findString(data, [
    'expires_at',
    'expiresAt',
    'expiry',
    'expires',
    'valid_until',
  ]);
  const invitedEmail = findString(data, ['invited_email', 'invitedEmail']);
  const boundToEmail =
    !!data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).bound_to_email === true;
  return { code, expiresAt, invitedEmail, boundToEmail };
}

export type InviteErrorKind =
  | 'invalid-or-expired'
  | 'invalid-invited-email'
  | 'rate-limited'
  | 'expired'
  | 'already-used'
  | 'self-pairing'
  | 'invalid'
  | 'network'
  | 'unauthenticated'
  | 'unknown';

/** Classify an Edge Function failure into an honest UI state. The
 *  deployed function uses ONE combined code — invalid_or_expired_invite —
 *  for invalid, expired, reused and self-pairing attempts alike, and it
 *  is checked FIRST so the UI never claims "expired" for a typo'd code. */
export function classifyInviteErrorMessage(message: string): InviteErrorKind {
  const m = message.toLowerCase();
  if (m.includes('invalid_or_expired')) return 'invalid-or-expired';
  if (m.includes('invalid_invited_email')) return 'invalid-invited-email';
  // Deployed create-guardian-invite rate-limits per wearer
  // ({"error":"invite_rate_limited"} — verified live 2026-10-31).
  if (/rate.?limit|too many/.test(m)) return 'rate-limited';
  if (/expir/.test(m)) return 'expired';
  if (/already|used|redeemed|consumed/.test(m)) return 'already-used';
  if (/self|own code|your own|same user/.test(m)) return 'self-pairing';
  if (/unauthor|unauthen|jwt|session|not signed/.test(m)) return 'unauthenticated';
  if (/invalid|not found|incorrect|no such|unknown code/.test(m)) return 'invalid';
  if (/failed to fetch|network|fetch failed|timeout|socket/.test(m)) return 'network';
  return 'unknown';
}

/** Extract the function's own error body when supabase-js wraps it. */
async function extractFunctionError(error: unknown): Promise<GatewayError> {
  const err = error as {
    message?: string;
    context?: { json?: () => Promise<unknown>; text?: () => Promise<string> };
  } | null;
  let message = err?.message ?? 'Edge Function call failed';
  const ctx = err?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as Row | null;
      const inner =
        (body && (body.error as string)) ||
        (body && (body.message as string)) ||
        (body && (body.msg as string));
      if (typeof inner === 'string' && inner.length > 0) message = inner;
    } catch {
      if (typeof ctx.text === 'function') {
        try {
          const text = await ctx.text();
          if (text) message = text;
        } catch {
          /* keep the wrapper message */
        }
      }
    }
  }
  return new GatewayError(message, classifyInviteErrorMessage(message));
}

/** Wearer: create an invite for a specific recipient email. The
 *  hardened function binds the code to this email; the currently
 *  deployed function accepts and ignores the field (verified live
 *  2026-11-06) and returns no binding confirmation, which
 *  parseInvitePayload reflects honestly as boundToEmail=false. */
export async function createInvite(
  client: GatewayClient,
  invitedEmail: string,
): Promise<Invite> {
  const { data, error } = await client.functions.invoke(DEPLOYED.functions.createInvite, {
    body: { invited_email: invitedEmail },
  });
  if (error) throw await extractFunctionError(error);
  return parseInvitePayload(data);
}

export interface AcceptInviteResult {
  linkId: string | null;
  /** The deployed function returns status 'paired' on success. */
  status: string | null;
}

/** Guardian: accept an invite code. Success means the link EXISTS
 *  (paired immediately — there is no approval step in the deployed
 *  model), but BOTH consent flags start FALSE: the wearer still
 *  decides per link what this guardian may see. */
export async function acceptInvite(
  client: GatewayClient,
  inviteCode: string,
): Promise<AcceptInviteResult> {
  const { data, error } = await client.functions.invoke(DEPLOYED.functions.acceptInvite, {
    body: { invite_code: inviteCode },
  });
  if (error) throw await extractFunctionError(error);
  return {
    linkId: findString(data, ['link_id', 'linkId', 'id']),
    status: findString(data, ['status']),
  };
}

// ---------------------------------------------------------------------------
// Links + per-link consent
// ---------------------------------------------------------------------------

export interface LinkInfo {
  id: string;
  /** The wearer being shared (subject_user_id). */
  ownerId: string;
  guardianId: string;
  locationSharingEnabled: boolean;
  sosSharingEnabled: boolean;
  createdAt: string | null;
  acceptedAt: string | null;
}

export interface ConsentState {
  locationSharingEnabled: boolean;
  sosSharingEnabled: boolean;
}

export const DEFAULT_CONSENT: ConsentState = {
  locationSharingEnabled: false,
  sosSharingEnabled: false,
};

/** Aggregate a wearer's links into one consent view: a capability is
 *  ON when at least one link grants it. With no links, both are OFF. */
export function aggregateConsent(links: LinkInfo[]): ConsentState {
  return {
    locationSharingEnabled: links.some((l) => l.locationSharingEnabled),
    sosSharingEnabled: links.some((l) => l.sosSharingEnabled),
  };
}

function parseLink(row: Row): LinkInfo | null {
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    ownerId: typeof row.subject_user_id === 'string' ? row.subject_user_id : '',
    guardianId: typeof row.guardian_user_id === 'string' ? row.guardian_user_id : '',
    locationSharingEnabled: row.location_sharing_enabled === true,
    sosSharingEnabled: row.sos_sharing_enabled === true,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    acceptedAt: typeof row.accepted_at === 'string' ? row.accepted_at : null,
  };
}

const LINK_SELECT =
  'id, subject_user_id, guardian_user_id, location_sharing_enabled, sos_sharing_enabled, created_at, accepted_at';

async function listLinksBy(
  client: GatewayClient,
  column: 'subject_user_id' | 'guardian_user_id',
  uid: string,
): Promise<LinkInfo[]> {
  const { data, error } = (await client
    .from(DEPLOYED.tables.links)
    .select(LINK_SELECT)
    .eq(column, uid)
    .order('created_at', { ascending: false })) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  return rows.map(parseLink).filter((l): l is LinkInfo => l !== null);
}

/** Links where the user is the SUBJECT/wearer (their guardians). */
export function listLinksAsOwner(client: GatewayClient, uid: string): Promise<LinkInfo[]> {
  return listLinksBy(client, 'subject_user_id', uid);
}

/** Links where the user is the GUARDIAN (people sharing with them). */
export function listLinksAsGuardian(client: GatewayClient, uid: string): Promise<LinkInfo[]> {
  return listLinksBy(client, 'guardian_user_id', uid);
}

/**
 * Change consent on ONE link. Only the wearer (subject) can do this —
 * RLS silently affects 0 rows for anyone else, which is detected here
 * and surfaced as an error instead of a fake success.
 */
export async function setLinkConsent(
  client: GatewayClient,
  linkId: string,
  patch: Partial<ConsentState>,
): Promise<LinkInfo> {
  const fields: Row = {};
  if (patch.locationSharingEnabled !== undefined) {
    fields.location_sharing_enabled = patch.locationSharingEnabled;
  }
  if (patch.sosSharingEnabled !== undefined) {
    fields.sos_sharing_enabled = patch.sosSharingEnabled;
  }
  if (Object.keys(fields).length === 0) {
    throw new GatewayError('empty consent patch', 'unknown');
  }
  const { data, error } = (await client
    .from(DEPLOYED.tables.links)
    .update(fields)
    .eq('id', linkId)
    .select(LINK_SELECT)) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  const rows = Array.isArray(data) ? (data as Row[]) : [];
  const updated = rows[0] ? parseLink(rows[0]) : null;
  if (!updated) {
    throw new GatewayError(
      'consent update was not applied — only the wearer can change consent on a link',
      'unknown',
    );
  }
  return updated;
}

/** Unlink: delete the link row (either party may — RLS decides). */
export async function deleteLink(client: GatewayClient, linkId: string): Promise<void> {
  const { data, error } = (await client
    .from(DEPLOYED.tables.links)
    .delete()
    .eq('id', linkId)
    .select('id')) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    throw new GatewayError('unlink was not applied', 'unknown');
  }
}

/** Display names for a set of users (RLS-limited to what we may see). */
export async function fetchDisplayNames(
  client: GatewayClient,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (userIds.length === 0) return map;
  const { data } = (await client
    .from(DEPLOYED.tables.profiles)
    .select('id, display_name')
    .in('id', userIds)) as GatewayQueryResult;
  for (const row of (Array.isArray(data) ? data : []) as Row[]) {
    if (typeof row.id === 'string') {
      map.set(row.id, (row.display_name as string | null) ?? null);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Locations (latest-only, keyed by subject_user_id)
// ---------------------------------------------------------------------------

export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: string; // ISO (client-side bookkeeping; server stamps its own)
}

export interface LatestLocationRow extends LocationFix {
  userId: string;
  updatedAt: string | null;
}

const SUBJECT = 'subject_user_id';

/** Upsert the wearer's LATEST fix (one row per wearer). The server
 *  stamps recorded_at at insert and updated_at on every write, so the
 *  client sends coordinates only. */
export async function upsertLatestLocation(
  client: GatewayClient,
  uid: string,
  fix: LocationFix,
): Promise<void> {
  const { error } = (await client.from(DEPLOYED.tables.locations).upsert(
    {
      [SUBJECT]: uid,
      latitude: fix.lat,
      longitude: fix.lng,
      accuracy_m: fix.accuracyM,
    },
    { onConflict: SUBJECT },
  )) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
}

/** Delete the wearer's latest-location row (privacy on consent-off). */
export async function deleteLatestLocation(client: GatewayClient, uid: string): Promise<void> {
  const { error } = (await client
    .from(DEPLOYED.tables.locations)
    .delete()
    .eq(SUBJECT, uid)) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
}

export async function getLatestLocation(
  client: GatewayClient,
  wearerId: string,
): Promise<LatestLocationRow | null> {
  const { data, error } = (await client
    .from(DEPLOYED.tables.locations)
    .select(`${SUBJECT}, latitude, longitude, accuracy_m, recorded_at, updated_at`)
    .eq(SUBJECT, wearerId)
    .maybeSingle()) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  const row = data as Row | null;
  if (!row) return null;
  return {
    userId: wearerId,
    lat: row.latitude as number,
    lng: row.longitude as number,
    accuracyM: (row.accuracy_m as number | null) ?? null,
    recordedAt: (row.recorded_at as string) ?? (row.updated_at as string) ?? '',
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// SOS alerts
// ---------------------------------------------------------------------------

/** Insert an SOS alert for the wearer (status defaults to 'active'
 *  server-side; the location snapshot is included when available). */
export async function insertSosAlert(
  client: GatewayClient,
  uid: string,
  fix: LocationFix | null,
): Promise<void> {
  const row: Row = { [SUBJECT]: uid };
  if (fix) {
    row.latitude = fix.lat;
    row.longitude = fix.lng;
    row.accuracy_m = fix.accuracyM;
  }
  const { error } = (await client
    .from(DEPLOYED.tables.sosAlerts)
    .insert(row)) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
}

export interface SosAlertInfo {
  id: string | null;
  userId: string;
  lat: number | null;
  lng: number | null;
  status: string | null;
  createdAt: string | null; // triggered_at
  resolvedAt: string | null;
}

function parseSos(row: Row): SosAlertInfo {
  return {
    id: typeof row.id === 'string' ? row.id : null,
    userId: String(row[SUBJECT] ?? ''),
    lat: typeof row.latitude === 'number' ? row.latitude : null,
    lng: typeof row.longitude === 'number' ? row.longitude : null,
    status: typeof row.status === 'string' ? row.status : null,
    createdAt: typeof row.triggered_at === 'string' ? row.triggered_at : null,
    resolvedAt: typeof row.resolved_at === 'string' ? row.resolved_at : null,
  };
}

export async function listSosAlerts(
  client: GatewayClient,
  wearerIds: string[],
  limit = 20,
): Promise<SosAlertInfo[]> {
  if (wearerIds.length === 0) return [];
  const { data, error } = (await client
    .from(DEPLOYED.tables.sosAlerts)
    .select('*')
    .in(SUBJECT, wearerIds)
    .order('triggered_at', { ascending: false })
    .limit(limit)) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  return ((Array.isArray(data) ? data : []) as Row[]).map(parseSos);
}

/**
 * Resolve the wearer's OWN active alerts ("I am OK"). Updates are
 * wearer-only in the deployed RLS — a guardian cannot resolve.
 * Clients cannot DELETE alerts at all (safety log); resolving is the
 * only terminal transition.
 */
export async function resolveOwnActiveSosAlerts(
  client: GatewayClient,
  uid: string,
): Promise<void> {
  const { error } = (await client
    .from(DEPLOYED.tables.sosAlerts)
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq(SUBJECT, uid)
    .eq('status', 'active')) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
}

// ---------------------------------------------------------------------------
// Push tokens (REGISTRATION only — delivery is a server concern and is
// NOT claimed anywhere; see docs/SUPABASE_INTEGRATION.md)
// ---------------------------------------------------------------------------

export type PushPlatform = 'android' | 'ios';

/**
 * Register (or refresh) the current device token for the signed-in
 * user. Replaces the user's previous row for the platform so a
 * refreshed token never leaves a stale one behind. The deployed value
 * column is expo_push_token; the fallbacks cost one failed insert each
 * and exist only in case the project schema is ever renamed.
 */
const TOKEN_VALUE_COLUMNS = ['expo_push_token', 'token', 'endpoint', 'push_token'];

export function isMissingColumnError(message: string, column: string): boolean {
  return (
    message.includes(`'${column}' column`) ||
    message.includes(`"${column}"`) ||
    message.includes(` ${column} `)
  );
}

export async function registerPushToken(
  client: GatewayClient,
  uid: string,
  token: string,
  platform: PushPlatform,
): Promise<void> {
  await removePushTokens(client, uid, platform);
  let lastError: string | null = null;
  for (const valueColumn of TOKEN_VALUE_COLUMNS) {
    const row: Row = { user_id: uid, platform, [valueColumn]: token };
    const { error } = (await client
      .from(DEPLOYED.tables.pushTokens)
      .insert(row)) as GatewayQueryResult;
    if (!error) return;
    lastError = error.message;
    if (!isMissingColumnError(error.message, valueColumn)) {
      throw new GatewayError(error.message, 'server');
    }
  }
  throw new GatewayError(lastError ?? 'push token registration failed', 'server');
}

/** Remove the user's token rows (sign-out cleanup; platform optional). */
export async function removePushTokens(
  client: GatewayClient,
  uid: string,
  platform?: PushPlatform,
): Promise<void> {
  let query = client.from(DEPLOYED.tables.pushTokens).delete().eq('user_id', uid);
  if (platform) query = query.eq('platform', platform);
  const { error } = (await query) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
}

// ---------------------------------------------------------------------------
// Account data cleanup. The deployed project exposes no client-callable
// auth-account deletion; this removes the user's DATA rows. One
// exception, verified live: sos_alerts rows CANNOT be deleted by
// clients (append-only safety log) — the delete below silently
// affects 0 rows there, and the UI copy says alerts are retained.
// ---------------------------------------------------------------------------

export async function deleteAllUserData(client: GatewayClient, uid: string): Promise<void> {
  const steps: [string, () => Promise<GatewayQueryResult>][] = [
    [
      DEPLOYED.tables.locations,
      async () =>
        (await client.from(DEPLOYED.tables.locations).delete().eq(SUBJECT, uid)) as GatewayQueryResult,
    ],
    [
      DEPLOYED.tables.pushTokens,
      async () =>
        (await client.from(DEPLOYED.tables.pushTokens).delete().eq('user_id', uid)) as GatewayQueryResult,
    ],
    [
      `${DEPLOYED.tables.links} (as subject)`,
      async () =>
        (await client.from(DEPLOYED.tables.links).delete().eq(SUBJECT, uid)) as GatewayQueryResult,
    ],
    [
      `${DEPLOYED.tables.links} (as guardian)`,
      async () =>
        (await client
          .from(DEPLOYED.tables.links)
          .delete()
          .eq('guardian_user_id', uid)) as GatewayQueryResult,
    ],
    [
      DEPLOYED.tables.profiles,
      async () =>
        (await client.from(DEPLOYED.tables.profiles).delete().eq('id', uid)) as GatewayQueryResult,
    ],
  ];
  for (const [label, run] of steps) {
    const { error } = await run();
    if (error) throw new GatewayError(`${label}: ${error.message}`, 'server');
  }
}

// ---------------------------------------------------------------------------
// Realtime subscriptions (postgres_changes). VERIFIED LIVE: a guardian
// subscribed to guardian_locations + sos_alerts received the wearer's
// INSERT events within seconds (discovery round 4, 2026-10-31).
// ---------------------------------------------------------------------------

export interface Subscription {
  unsubscribe(): Promise<void>;
}

function makeSubscription(client: GatewayClient, channel: unknown): Subscription {
  return {
    async unsubscribe() {
      await client.removeChannel(channel).catch(() => undefined);
    },
  };
}

/** Live latest-location changes for one wearer. */
export function subscribeWearerLocation(
  client: GatewayClient,
  wearerId: string,
  onChange: (row: LatestLocationRow | null, eventType: string) => void,
): Subscription {
  const channel = client
    .channel(`basera-guardian-location-${wearerId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: DEPLOYED.tables.locations,
        filter: `${SUBJECT}=eq.${wearerId}`,
      },
      (payload: { eventType: string; new: Row | null; old: Row | null }) => {
        if (payload.eventType === 'DELETE' || !payload.new) {
          onChange(null, payload.eventType);
          return;
        }
        const row = payload.new;
        onChange(
          {
            userId: wearerId,
            lat: row.latitude as number,
            lng: row.longitude as number,
            accuracyM: (row.accuracy_m as number | null) ?? null,
            recordedAt: (row.recorded_at as string) ?? (row.updated_at as string) ?? '',
            updatedAt: (row.updated_at as string | null) ?? null,
          },
          payload.eventType,
        );
      },
    )
    .subscribe();
  return makeSubscription(client, channel);
}

/** Live SOS inserts for a set of wearers. */
export function subscribeWearerSos(
  client: GatewayClient,
  wearerIds: string[],
  onAlert: (alert: SosAlertInfo) => void,
): Subscription {
  const channels: unknown[] = [];
  for (const wearerId of wearerIds) {
    const channel = client
      .channel(`basera-guardian-sos-${wearerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: DEPLOYED.tables.sosAlerts,
          filter: `${SUBJECT}=eq.${wearerId}`,
        },
        (payload: { new: Row }) => {
          onAlert(parseSos(payload.new ?? {}));
        },
      )
      .subscribe();
    channels.push(channel);
  }
  return {
    async unsubscribe() {
      for (const ch of channels) {
        await client.removeChannel(ch).catch(() => undefined);
      }
    },
  };
}

/** Live link changes involving the signed-in user (either role). */
export function subscribeUserLinks(
  client: GatewayClient,
  uid: string,
  onChange: () => void,
): Subscription {
  const channel = client
    .channel(`basera-links-${uid}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: DEPLOYED.tables.links,
        filter: `${SUBJECT}=eq.${uid}`,
      },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: DEPLOYED.tables.links,
        filter: `guardian_user_id=eq.${uid}`,
      },
      () => onChange(),
    )
    .subscribe();
  return makeSubscription(client, channel);
}
