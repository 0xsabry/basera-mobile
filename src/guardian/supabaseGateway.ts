/**
 * Supabase gateway — the ONE module that knows the DEPLOYED contract of
 * the owner's Supabase project (vbvvwyeccsegfwprwrga). Every table name,
 * column name and Edge Function name used by the guardian features lives
 * here and nowhere else, so a discovery correction is a one-file change.
 *
 * Deployed contract (owner-created project; see
 * docs/SUPABASE_INTEGRATION.md):
 * - Tables (authenticated-only; the anon role has NO grants):
 *   profiles, guardian_links, guardian_locations, sos_alerts,
 *   user_push_tokens. There is no invites table and no RPC pairing API —
 *   pairing lives behind the Edge Functions below.
 * - Edge Functions (require the signed-in user's JWT; an apikey-only
 *   call is rejected): `create-guardian-invite` (wearer) and
 *   `accept-guardian-invite` (guardian, body { invite_code }).
 * - guardian_locations holds ONLY the latest fix per wearer (upsert).
 * - Consent lives on profiles: location_sharing_enabled and
 *   sos_sharing_enabled, both default FALSE, wearer-controlled.
 *
 * The project's exact column list was never published (the OpenAPI root
 * requires a secret key), so reads/writes below are written defensively:
 * unknown OPTIONAL columns are dropped and retried once when PostgREST
 * reports them missing, and payloads from the Edge Functions are parsed
 * by searching the documented key names. The wearer key column of
 * guardian_locations / sos_alerts / user_push_tokens is centralized in
 * WEARER_COLUMN. scripts/live-rls-test.mjs runs a discovery phase that
 * prints the real columns once confirmed test accounts exist.
 *
 * All access goes through the signed-in user's JWT — RLS is the only
 * authorization layer; nothing here bypasses it and no secret key exists
 * in client code.
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
  /** Column that identifies the wearer in locations / sos / token rows. */
  wearerColumn: 'user_id',
  profileColumns: {
    id: 'id',
    displayName: 'display_name',
    locationSharing: 'location_sharing_enabled',
    sosSharing: 'sos_sharing_enabled',
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
// Minimal structural client surface (the real SupabaseClient satisfies it;
// tests inject fakes). Kept loose on purpose — supabase-js builders are
// thenables with chainable filters.
// ---------------------------------------------------------------------------

export interface GatewayQueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface GatewayClient {
  from(table: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  functions: {
    invoke(
      name: string,
      options?: { body?: Record<string, unknown> },
    ): Promise<{ data: unknown; error: unknown }>;
  };
  channel(name: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  removeChannel(channel: unknown): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Profiles + consent
// ---------------------------------------------------------------------------

export interface ConsentState {
  locationSharingEnabled: boolean;
  sosSharingEnabled: boolean;
}

export const DEFAULT_CONSENT: ConsentState = {
  locationSharingEnabled: false,
  sosSharingEnabled: false,
};

export interface ProfileInfo {
  id: string;
  displayName: string | null;
  consent: ConsentState;
}

type Row = Record<string, unknown>;

function parseConsent(row: Row | null | undefined): ConsentState {
  if (!row) return { ...DEFAULT_CONSENT };
  const pc = DEPLOYED.profileColumns;
  return {
    locationSharingEnabled: row[pc.locationSharing] === true,
    sosSharingEnabled: row[pc.sosSharing] === true,
  };
}

function parseProfile(row: Row | null | undefined): ProfileInfo | null {
  if (!row || typeof row[DEPLOYED.profileColumns.id] !== 'string') return null;
  return {
    id: row[DEPLOYED.profileColumns.id] as string,
    displayName: (row[DEPLOYED.profileColumns.displayName] as string | null) ?? null,
    consent: parseConsent(row),
  };
}

const PROFILE_SELECT = 'id, display_name, location_sharing_enabled, sos_sharing_enabled';

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
 * Idempotently make sure the signed-in user has a profile row.
 * - Existing row: returned as-is; consent is NEVER reset by this call,
 *   and a display name is only filled in when the row has none.
 * - Missing row: inserted with both consents FALSE (the privacy default).
 */
export async function ensureProfile(
  client: GatewayClient,
  user: { id: string; email: string | null },
  displayName?: string | null,
): Promise<ProfileInfo> {
  const existing = await selectOwnProfile(client, user.id);
  if (existing) {
    const profile = parseProfile(existing)!;
    const wanted = displayName?.trim();
    if (wanted && !profile.displayName) {
      const { error } = (await client
        .from(DEPLOYED.tables.profiles)
        .update({ [DEPLOYED.profileColumns.displayName]: wanted })
        .eq('id', user.id)) as GatewayQueryResult;
      if (!error) profile.displayName = wanted;
    }
    return profile;
  }
  const fallbackName =
    displayName?.trim() || (user.email ? user.email.split('@')[0] : null) || null;
  const row: Row = {
    id: user.id,
    [DEPLOYED.profileColumns.displayName]: fallbackName,
    [DEPLOYED.profileColumns.locationSharing]: false,
    [DEPLOYED.profileColumns.sosSharing]: false,
  };
  const { error } = (await client
    .from(DEPLOYED.tables.profiles)
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true })) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  const created = await selectOwnProfile(client, user.id);
  return (
    parseProfile(created) ?? {
      id: user.id,
      displayName: fallbackName,
      consent: { ...DEFAULT_CONSENT },
    }
  );
}

/** Consent for the signed-in user; a missing profile means both OFF. */
export async function getConsent(client: GatewayClient, uid: string): Promise<ConsentState> {
  const row = await selectOwnProfile(client, uid);
  return parseConsent(row);
}

/**
 * Persist a consent change. Uses UPDATE first so an existing row's other
 * consent flag is never clobbered; inserts a full default row only when
 * the profile does not exist yet.
 */
export async function updateConsent(
  client: GatewayClient,
  uid: string,
  patch: Partial<ConsentState>,
): Promise<ConsentState> {
  const pc = DEPLOYED.profileColumns;
  const fields: Row = {};
  if (patch.locationSharingEnabled !== undefined) {
    fields[pc.locationSharing] = patch.locationSharingEnabled;
  }
  if (patch.sosSharingEnabled !== undefined) {
    fields[pc.sosSharing] = patch.sosSharingEnabled;
  }
  if (Object.keys(fields).length === 0) return getConsent(client, uid);
  const { data, error } = (await client
    .from(DEPLOYED.tables.profiles)
    .update(fields)
    .eq('id', uid)
    .select(PROFILE_SELECT)) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  const updated = Array.isArray(data) ? (data[0] as Row | undefined) : (data as Row | null);
  if (updated) return parseConsent(updated);
  // No row yet -> create it with defaults + this patch.
  const row: Row = {
    id: uid,
    [pc.locationSharing]: patch.locationSharingEnabled ?? false,
    [pc.sosSharing]: patch.sosSharingEnabled ?? false,
  };
  const { error: insertError } = (await client
    .from(DEPLOYED.tables.profiles)
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true })) as GatewayQueryResult;
  if (insertError) throw new GatewayError(insertError.message, 'server');
  return getConsent(client, uid);
}

// ---------------------------------------------------------------------------
// Pairing via Edge Functions
// ---------------------------------------------------------------------------

export interface Invite {
  code: string;
  /** ISO timestamp from the function payload, when it provides one. */
  expiresAt: string | null;
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
  return { code, expiresAt };
}

export type InviteErrorKind =
  | 'expired'
  | 'already-used'
  | 'self-pairing'
  | 'invalid'
  | 'network'
  | 'unauthenticated'
  | 'unknown';

/** Classify an Edge Function failure message into an honest UI state. */
export function classifyInviteErrorMessage(message: string): InviteErrorKind {
  const m = message.toLowerCase();
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

/** Wearer: create an invite. The function returns the code + expiry. */
export async function createInvite(client: GatewayClient): Promise<Invite> {
  const { data, error } = await client.functions.invoke(DEPLOYED.functions.createInvite);
  if (error) throw await extractFunctionError(error);
  return parseInvitePayload(data);
}

export interface AcceptInviteResult {
  /** Wearer (owner) id when the function payload carries it. */
  ownerId: string | null;
  linkId: string | null;
}

/** Guardian: accept an invite code. Success means the link is ACTIVE —
 *  the deployed model has no separate owner-approval step. */
export async function acceptInvite(
  client: GatewayClient,
  inviteCode: string,
): Promise<AcceptInviteResult> {
  const { data, error } = await client.functions.invoke(DEPLOYED.functions.acceptInvite, {
    body: { invite_code: inviteCode },
  });
  if (error) throw await extractFunctionError(error);
  return {
    ownerId: findString(data, ['owner_id', 'wearer_id', 'ownerId']),
    linkId: findString(data, ['link_id', 'linkId', 'id']),
  };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export type LinkStatus = 'pending' | 'active' | 'revoked' | string;

export interface LinkInfo {
  id: string;
  ownerId: string;
  guardianId: string;
  /** Deployed rows may omit status; absence is treated as 'active'
   *  because accept-guardian-invite activates the link immediately. */
  status: LinkStatus;
  createdAt: string | null;
}

function parseLink(row: Row): LinkInfo | null {
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    ownerId: typeof row.owner_id === 'string' ? row.owner_id : '',
    guardianId: typeof row.guardian_id === 'string' ? row.guardian_id : '',
    status: typeof row.status === 'string' ? row.status : 'active',
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
  };
}

const LINK_SELECT_WITH_STATUS = 'id, owner_id, guardian_id, status, created_at';
const LINK_SELECT_PLAIN = 'id, owner_id, guardian_id, created_at';

async function listLinksBy(
  client: GatewayClient,
  column: 'owner_id' | 'guardian_id',
  uid: string,
): Promise<LinkInfo[]> {
  const run = async (cols: string) =>
    (await client
      .from(DEPLOYED.tables.links)
      .select(cols)
      .eq(column, uid)
      .order('created_at', { ascending: false })) as GatewayQueryResult;
  let res = await run(LINK_SELECT_WITH_STATUS);
  if (res.error && isMissingColumnError(res.error.message, 'status')) {
    res = await run(LINK_SELECT_PLAIN);
  }
  if (res.error) throw new GatewayError(res.error.message, 'server');
  const rows = Array.isArray(res.data) ? (res.data as Row[]) : [];
  return rows
    .map(parseLink)
    .filter((l): l is LinkInfo => l !== null)
    .filter((l) => l.status !== 'revoked');
}

/** Links where the user is the WEARER (their guardians). */
export function listLinksAsOwner(client: GatewayClient, uid: string): Promise<LinkInfo[]> {
  return listLinksBy(client, 'owner_id', uid);
}

/** Links where the user is the GUARDIAN (people sharing with them). */
export function listLinksAsGuardian(client: GatewayClient, uid: string): Promise<LinkInfo[]> {
  return listLinksBy(client, 'guardian_id', uid);
}

/** Unlink: delete the link row (RLS decides whether the caller may). */
export async function deleteLink(client: GatewayClient, linkId: string): Promise<void> {
  const { error } = (await client
    .from(DEPLOYED.tables.links)
    .delete()
    .eq('id', linkId)) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
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
// Locations (latest-only)
// ---------------------------------------------------------------------------

export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: string; // ISO
}

export interface LatestLocationRow extends LocationFix {
  userId: string;
  updatedAt: string | null;
}

/** PostgREST/PG "column does not exist" errors name the column — used to
 *  drop optional columns and retry once against the real schema. */
export function missingColumnName(message: string): string | null {
  const pg = /column (?:["\w.]+\.)?"?([a-z_][a-z0-9_]*)"? does not exist/i.exec(message);
  if (pg) return pg[1];
  const pgrst = /Could not find the '([a-z_][a-z0-9_]*)' column/i.exec(message);
  if (pgrst) return pgrst[1];
  const schemaCache = /'([a-z_][a-z0-9_]*)' column of '[^']+' in the schema cache/i.exec(message);
  if (schemaCache) return schemaCache[1];
  return null;
}

export function isMissingColumnError(message: string, column?: string): boolean {
  const found = missingColumnName(message);
  if (!found) return false;
  return column === undefined || found === column;
}

/** Columns a write must never silently lose (a row without them is
 *  meaningless or unaddressable). */
const PROTECTED_COLUMNS = new Set([DEPLOYED.wearerColumn, 'lat', 'lng']);

/** Drop OPTIONAL columns PostgREST says do not exist; retry up to 3
 *  times. Protected columns are never dropped — their absence is a
 *  real schema problem and surfaces as an error instead. */
async function withColumnFallback<T extends Row>(
  row: T,
  run: (row: T) => Promise<GatewayQueryResult>,
): Promise<void> {
  let current: Row = { ...row };
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await run(current as T);
    if (!error) return;
    const missing = missingColumnName(error.message);
    if (missing && missing in current && !PROTECTED_COLUMNS.has(missing)) {
      const next = { ...current };
      delete next[missing];
      current = next;
      continue;
    }
    throw new GatewayError(error.message, 'server');
  }
  throw new GatewayError('column fallback exhausted', 'server');
}

/** Upsert the wearer's LATEST fix (the table keeps one row per wearer). */
export async function upsertLatestLocation(
  client: GatewayClient,
  uid: string,
  fix: LocationFix,
): Promise<void> {
  const wc = DEPLOYED.wearerColumn;
  const row: Row = {
    [wc]: uid,
    lat: fix.lat,
    lng: fix.lng,
    accuracy_m: fix.accuracyM,
    recorded_at: fix.recordedAt,
    updated_at: new Date().toISOString(),
  };
  await withColumnFallback(row, async (r) =>
    (await client
      .from(DEPLOYED.tables.locations)
      .upsert(r, { onConflict: wc })) as GatewayQueryResult,
  );
}

/** Delete the wearer's latest-location row (privacy on consent-off). */
export async function deleteLatestLocation(client: GatewayClient, uid: string): Promise<void> {
  const { error } = (await client
    .from(DEPLOYED.tables.locations)
    .delete()
    .eq(DEPLOYED.wearerColumn, uid)) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
}

export async function getLatestLocation(
  client: GatewayClient,
  wearerId: string,
): Promise<LatestLocationRow | null> {
  const wc = DEPLOYED.wearerColumn;
  const run = async (cols: string) =>
    (await client
      .from(DEPLOYED.tables.locations)
      .select(cols)
      .eq(wc, wearerId)
      .maybeSingle()) as GatewayQueryResult;
  let res = await run(`${wc}, lat, lng, accuracy_m, recorded_at, updated_at`);
  if (res.error && missingColumnName(res.error.message)) {
    res = await run(`${wc}, lat, lng`);
  }
  if (res.error) throw new GatewayError(res.error.message, 'server');
  const row = res.data as Row | null;
  if (!row) return null;
  return {
    userId: wearerId,
    lat: row.lat as number,
    lng: row.lng as number,
    accuracyM: (row.accuracy_m as number | null) ?? null,
    recordedAt: (row.recorded_at as string) ?? (row.updated_at as string) ?? '',
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// SOS alerts
// ---------------------------------------------------------------------------

/**
 * Insert an SOS alert for the wearer. Location snapshot columns are
 * optional and dropped automatically if the deployed table lacks them.
 */
export async function insertSosAlert(
  client: GatewayClient,
  uid: string,
  fix: LocationFix | null,
): Promise<void> {
  const wc = DEPLOYED.wearerColumn;
  const row: Row = { [wc]: uid };
  if (fix) {
    row.lat = fix.lat;
    row.lng = fix.lng;
    row.accuracy_m = fix.accuracyM;
  }
  await withColumnFallback(row, async (r) =>
    (await client.from(DEPLOYED.tables.sosAlerts).insert(r)) as GatewayQueryResult,
  );
}

export interface SosAlertInfo {
  id: string | null;
  userId: string;
  lat: number | null;
  lng: number | null;
  createdAt: string | null;
}

export async function listSosAlerts(
  client: GatewayClient,
  wearerIds: string[],
  limit = 20,
): Promise<SosAlertInfo[]> {
  if (wearerIds.length === 0) return [];
  const wc = DEPLOYED.wearerColumn;
  const { data, error } = (await client
    .from(DEPLOYED.tables.sosAlerts)
    .select('*')
    .in(wc, wearerIds)
    .order('created_at', { ascending: false })
    .limit(limit)) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
  return ((Array.isArray(data) ? data : []) as Row[]).map((row) => ({
    id: typeof row.id === 'string' ? row.id : null,
    userId: String(row[wc] ?? ''),
    lat: typeof row.lat === 'number' ? row.lat : null,
    lng: typeof row.lng === 'number' ? row.lng : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : null,
  }));
}

// ---------------------------------------------------------------------------
// Push tokens (REGISTRATION only — delivery is a server concern and is
// NOT claimed anywhere; see docs/SUPABASE_INTEGRATION.md)
// ---------------------------------------------------------------------------

export type PushPlatform = 'android-expo' | 'web-fcm';

const TOKEN_VALUE_COLUMNS = ['token', 'endpoint', 'push_token', 'expo_push_token'];

/**
 * Register (or refresh) the current device token for the signed-in user.
 * Replaces the user's previous row for the platform so a refreshed token
 * never leaves a stale one behind.
 */
export async function registerPushToken(
  client: GatewayClient,
  uid: string,
  token: string,
  platform: PushPlatform,
): Promise<void> {
  const wc = DEPLOYED.wearerColumn;
  await removePushTokens(client, uid, platform);
  let lastError: string | null = null;
  for (const valueColumn of TOKEN_VALUE_COLUMNS) {
    const row: Row = { [wc]: uid, platform, [valueColumn]: token };
    const { error } = (await client
      .from(DEPLOYED.tables.pushTokens)
      .insert(row)) as GatewayQueryResult;
    if (!error) return;
    lastError = error.message;
    // A missing VALUE column means: try the next candidate name. Any
    // other failure (RLS, network, a missing structural column) is
    // real — surface it immediately instead of guessing further.
    if (!isMissingColumnError(error.message, valueColumn)) {
      throw new GatewayError(error.message, 'server');
    }
  }
  throw new GatewayError(lastError ?? 'push token registration failed', 'server');
}

/** Remove the user's token rows for a platform (sign-out / disable). */
export async function removePushTokens(
  client: GatewayClient,
  uid: string,
  platform?: PushPlatform,
): Promise<void> {
  let query = client
    .from(DEPLOYED.tables.pushTokens)
    .delete()
    .eq(DEPLOYED.wearerColumn, uid);
  if (platform) query = query.eq('platform', platform);
  const { error } = (await query) as GatewayQueryResult;
  if (error) throw new GatewayError(error.message, 'server');
}

// ---------------------------------------------------------------------------
// Account data cleanup (the deployed project exposes no client-callable
// auth-account deletion; this removes the user's DATA rows, and the UI
// states honestly that full account removal is an owner action)
// ---------------------------------------------------------------------------

export async function deleteAllUserData(client: GatewayClient, uid: string): Promise<void> {
  const wc = DEPLOYED.wearerColumn;
  const steps: [string, () => Promise<GatewayQueryResult>][] = [
    [
      DEPLOYED.tables.locations,
      async () =>
        (await client.from(DEPLOYED.tables.locations).delete().eq(wc, uid)) as GatewayQueryResult,
    ],
    [
      DEPLOYED.tables.sosAlerts,
      async () =>
        (await client.from(DEPLOYED.tables.sosAlerts).delete().eq(wc, uid)) as GatewayQueryResult,
    ],
    [
      DEPLOYED.tables.pushTokens,
      async () =>
        (await client.from(DEPLOYED.tables.pushTokens).delete().eq(wc, uid)) as GatewayQueryResult,
    ],
    [
      `${DEPLOYED.tables.links} (as owner)`,
      async () =>
        (await client
          .from(DEPLOYED.tables.links)
          .delete()
          .eq('owner_id', uid)) as GatewayQueryResult,
    ],
    [
      `${DEPLOYED.tables.links} (as guardian)`,
      async () =>
        (await client
          .from(DEPLOYED.tables.links)
          .delete()
          .eq('guardian_id', uid)) as GatewayQueryResult,
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
// Realtime subscriptions (postgres_changes). Requires the tables to be
// in the supabase_realtime publication — the owner deployed it that way;
// if a channel never delivers, polling fallbacks in the clients remain.
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
  const wc = DEPLOYED.wearerColumn;
  const channel = client
    .channel(`basera-guardian-location-${wearerId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: DEPLOYED.tables.locations,
        filter: `${wc}=eq.${wearerId}`,
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
            lat: row.lat as number,
            lng: row.lng as number,
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
  const wc = DEPLOYED.wearerColumn;
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
          filter: `${wc}=eq.${wearerId}`,
        },
        (payload: { new: Row }) => {
          const row = payload.new ?? {};
          onAlert({
            id: typeof row.id === 'string' ? row.id : null,
            userId: wearerId,
            lat: typeof row.lat === 'number' ? row.lat : null,
            lng: typeof row.lng === 'number' ? row.lng : null,
            createdAt: typeof row.created_at === 'string' ? row.created_at : null,
          });
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
        filter: `owner_id=eq.${uid}`,
      },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: DEPLOYED.tables.links,
        filter: `guardian_id=eq.${uid}`,
      },
      () => onChange(),
    )
    .subscribe();
  return makeSubscription(client, channel);
}
