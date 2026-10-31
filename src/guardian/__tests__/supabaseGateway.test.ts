/**
 * supabaseGateway tests — the DISCOVERED deployed contract (live
 * discovery 2026-10-31, docs/SUPABASE_INTEGRATION.md): subject_user_id
 * links with per-link consent, latitude/longitude latest locations,
 * sos_alerts with triggered_at/status, expo_push_token registration,
 * Edge-Function pairing with the combined invalid_or_expired_invite
 * error. Runs against a fake supabase-js-shaped client; the LIVE
 * matrix is scripts/live-rls-test.mjs.
 */
import {
  acceptInvite,
  aggregateConsent,
  classifyInviteErrorMessage,
  createInvite,
  deleteAllUserData,
  deleteLatestLocation,
  deleteLink,
  ensureProfile,
  getLatestLocation,
  insertSosAlert,
  listLinksAsGuardian,
  listLinksAsOwner,
  listSosAlerts,
  parseInvitePayload,
  registerPushToken,
  removePushTokens,
  resolveOwnActiveSosAlerts,
  setLinkConsent,
  subscribeUserLinks,
  subscribeWearerLocation,
  upsertLatestLocation,
  GatewayError,
} from '../supabaseGateway';

type Row = Record<string, unknown>;

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: [string, string, unknown][];
  selectCols?: string;
}

type Responder = (call: Call) => { data: unknown; error: { message: string } | null } | undefined;

class FakeBuilder {
  op = 'select';
  payload: unknown = null;
  filters: [string, string, unknown][] = [];
  selectCols: string | undefined;
  onConflict: string | undefined;
  returning = false;

  constructor(
    private store: Record<string, Row[]>,
    private calls: Call[],
    private table: string,
    private responder?: Responder,
  ) {}

  select(cols?: string) {
    if (this.op === 'select') this.selectCols = cols;
    else this.returning = true;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push(['eq', col, val]);
    return this;
  }
  in(col: string, vals: unknown) {
    this.filters.push(['in', col, vals]);
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  insert(rows: unknown) {
    this.op = 'insert';
    this.payload = rows;
    return this;
  }
  upsert(rows: unknown, opts?: { onConflict?: string }) {
    this.op = 'upsert';
    this.payload = rows;
    this.onConflict = opts?.onConflict;
    return this;
  }
  update(fields: unknown) {
    this.op = 'update';
    this.payload = fields;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([kind, col, val]) =>
      kind === 'eq' ? row[col] === val : (val as unknown[]).includes(row[col]),
    );
  }

  private execute(): { data: unknown; error: { message: string } | null } {
    const call: Call = {
      table: this.table,
      op: this.op,
      payload: this.payload,
      filters: this.filters,
      selectCols: this.selectCols,
    };
    this.calls.push(call);
    const forced = this.responder?.(call);
    if (forced) return forced;
    const rows = (this.store[this.table] ??= []);
    switch (this.op) {
      case 'select':
        return { data: rows.filter((r) => this.matches(r)).map((r) => ({ ...r })), error: null };
      case 'insert': {
        const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
        rows.push(...(incoming as Row[]).map((r) => ({ ...r })));
        return { data: this.returning ? incoming : null, error: null };
      }
      case 'upsert': {
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        for (const inc of incoming) {
          const key = this.onConflict ?? 'id';
          const idx = rows.findIndex((r) => r[key] === inc[key]);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...inc };
          else rows.push({ ...inc });
        }
        return { data: null, error: null };
      }
      case 'update': {
        const updated: Row[] = [];
        for (const row of rows) {
          if (this.matches(row)) {
            Object.assign(row, this.payload as Row);
            updated.push({ ...row });
          }
        }
        return { data: this.returning ? updated : null, error: null };
      }
      case 'delete': {
        const removed = rows.filter((r) => this.matches(r));
        this.store[this.table] = rows.filter((r) => !this.matches(r));
        return { data: this.returning ? removed : null, error: null };
      }
      default:
        return { data: null, error: null };
    }
  }

  maybeSingle() {
    const res = this.execute();
    if (res.error) return Promise.resolve(res);
    const arr = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
    return Promise.resolve({ data: arr[0] ?? null, error: null });
  }

  then(resolve: (v: { data: unknown; error: unknown }) => void) {
    resolve(this.execute());
  }
}

class FakeChannel {
  handlers: { event: string; filter: Record<string, unknown>; cb: (p: never) => void }[] = [];
  constructor(readonly name: string) {}
  on(event: string, filter: Record<string, unknown>, cb: (p: never) => void) {
    this.handlers.push({ event, filter, cb });
    return this;
  }
  subscribe() {
    return this;
  }
}

function fakeGatewayClient(responder?: Responder) {
  const store: Record<string, Row[]> = {
    profiles: [],
    guardian_links: [],
    guardian_locations: [],
    sos_alerts: [],
    user_push_tokens: [],
  };
  const calls: Call[] = [];
  const invokeCalls: { name: string; body?: Record<string, unknown> }[] = [];
  const invokeResponses = new Map<string, { data: unknown; error: unknown }>();
  const channels: FakeChannel[] = [];
  const removedChannels: unknown[] = [];
  const client = {
    from: (table: string) => new FakeBuilder(store, calls, table, responder),
    functions: {
      invoke: async (name: string, options?: { body?: Record<string, unknown> }) => {
        invokeCalls.push({ name, body: options?.body });
        return invokeResponses.get(name) ?? { data: null, error: null };
      },
    },
    channel: (name: string) => {
      const ch = new FakeChannel(name);
      channels.push(ch);
      return ch;
    },
    removeChannel: async (ch: unknown) => {
      removedChannels.push(ch);
      return 'ok';
    },
  };
  return { client: client as never, store, calls, invokeCalls, invokeResponses, channels, removedChannels };
}

const ME = 'user-me';
const LINK_ROW = {
  id: 'link-1',
  subject_user_id: ME,
  guardian_user_id: 'guardian-1',
  location_sharing_enabled: false,
  sos_sharing_enabled: false,
  consent_version: '1.0',
  created_at: '2026-10-31T10:00:00Z',
  accepted_at: '2026-10-31T10:00:00Z',
};

describe('invite payload parsing + error classification', () => {
  it('parses the deployed payload (dashed-hex code + expires_at)', () => {
    expect(
      parseInvitePayload({
        invite_code: 'A5F2-99D2-23CB-A24B-36A5-4D73-4468-E1A4',
        expires_at: '2026-10-31T11:05:41Z',
      }),
    ).toEqual({ code: 'A5F2-99D2-23CB-A24B-36A5-4D73-4468-E1A4', expiresAt: '2026-10-31T11:05:41Z' });
    expect(() => parseInvitePayload({ ok: true })).toThrow(GatewayError);
  });

  it('classifies the deployed combined error code FIRST (never claims "expired" for a typo)', () => {
    expect(classifyInviteErrorMessage('invalid_or_expired_invite')).toBe('invalid-or-expired');
    expect(classifyInviteErrorMessage('invite_rate_limited')).toBe('rate-limited');
    expect(classifyInviteErrorMessage('invite code has expired')).toBe('expired');
    expect(classifyInviteErrorMessage('code already used')).toBe('already-used');
    expect(classifyInviteErrorMessage('Failed to fetch')).toBe('network');
    expect(classifyInviteErrorMessage('something else')).toBe('unknown');
  });
});

describe('pairing via Edge Functions', () => {
  it('createInvite maps the deployed payload', async () => {
    const f = fakeGatewayClient();
    f.invokeResponses.set('create-guardian-invite', {
      data: { invite_code: 'AAAA-BBBB', expires_at: '2026-10-31T11:05:41Z' },
      error: null,
    });
    await expect(createInvite(f.client)).resolves.toEqual({
      code: 'AAAA-BBBB',
      expiresAt: '2026-10-31T11:05:41Z',
    });
    expect(f.invokeCalls[0].name).toBe('create-guardian-invite');
  });

  it('acceptInvite posts { invite_code } and maps { link_id, status: paired }', async () => {
    const f = fakeGatewayClient();
    f.invokeResponses.set('accept-guardian-invite', {
      data: { link_id: 'link-9', status: 'paired' },
      error: null,
    });
    await expect(acceptInvite(f.client, 'AAAA-BBBB')).resolves.toEqual({
      linkId: 'link-9',
      status: 'paired',
    });
    expect(f.invokeCalls[0]).toEqual({
      name: 'accept-guardian-invite',
      body: { invite_code: 'AAAA-BBBB' },
    });
  });

  it('acceptInvite surfaces invalid_or_expired_invite with its combined kind', async () => {
    const f = fakeGatewayClient();
    f.invokeResponses.set('accept-guardian-invite', {
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: { json: async () => ({ error: 'invalid_or_expired_invite' }) },
      },
    });
    await expect(acceptInvite(f.client, 'AAAA-BBBB')).rejects.toMatchObject({
      name: 'GatewayError',
      kind: 'invalid-or-expired',
      message: 'invalid_or_expired_invite',
    });
  });
});

describe('profiles (no consent columns, no trigger)', () => {
  it('ensureProfile inserts { id, display_name, preferred_language } only', async () => {
    const f = fakeGatewayClient();
    const profile = await ensureProfile(
      f.client,
      { id: ME, email: 'me@example.com' },
      { preferredLanguage: 'en' },
    );
    expect(profile.preferredLanguage).toBe('en');
    expect(f.store.profiles).toHaveLength(1);
    expect(f.store.profiles[0]).toEqual({ id: ME, display_name: 'me', preferred_language: 'en' });
  });

  it('ensureProfile never clobbers an existing row', async () => {
    const f = fakeGatewayClient();
    f.store.profiles.push({ id: ME, display_name: 'Real Name', preferred_language: 'ar' });
    const profile = await ensureProfile(
      f.client,
      { id: ME, email: 'me@example.com' },
      { displayName: 'Other', preferredLanguage: 'en' },
    );
    expect(profile.displayName).toBe('Real Name');
    expect(profile.preferredLanguage).toBe('ar');
    expect(f.calls.some((c) => c.op === 'upsert' || c.op === 'insert')).toBe(false);
  });
});

describe('links + per-link consent', () => {
  it('lists owner/guardian links mapping subject/guardian + consent flags', async () => {
    const f = fakeGatewayClient();
    f.store.guardian_links.push(
      { ...LINK_ROW },
      { ...LINK_ROW, id: 'link-2', subject_user_id: 'wearer-9', guardian_user_id: ME, location_sharing_enabled: true },
    );
    const mine = await listLinksAsOwner(f.client, ME);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ guardianId: 'guardian-1', locationSharingEnabled: false });
    const guarding = await listLinksAsGuardian(f.client, ME);
    expect(guarding).toHaveLength(1);
    expect(guarding[0].ownerId).toBe('wearer-9');
    expect(guarding[0].locationSharingEnabled).toBe(true);
  });

  it('aggregateConsent: ON when at least one link grants it', () => {
    expect(aggregateConsent([])).toEqual({ locationSharingEnabled: false, sosSharingEnabled: false });
    const base = {
      id: 'l', ownerId: ME, guardianId: 'g', createdAt: null, acceptedAt: null,
      locationSharingEnabled: false, sosSharingEnabled: false,
    };
    expect(aggregateConsent([base, { ...base, sosSharingEnabled: true }])).toEqual({
      locationSharingEnabled: false,
      sosSharingEnabled: true,
    });
  });

  it('setLinkConsent updates the row and returns it', async () => {
    const f = fakeGatewayClient();
    f.store.guardian_links.push({ ...LINK_ROW });
    const updated = await setLinkConsent(f.client, 'link-1', { locationSharingEnabled: true });
    expect(updated.locationSharingEnabled).toBe(true);
    expect(updated.sosSharingEnabled).toBe(false);
    expect(f.store.guardian_links[0].location_sharing_enabled).toBe(true);
  });

  it('setLinkConsent THROWS when RLS applies 0 rows (guardian attempting it)', async () => {
    const f = fakeGatewayClient((call) => {
      if (call.table === 'guardian_links' && call.op === 'update') {
        return { data: [], error: null }; // RLS silently filters the row out
      }
      return undefined;
    });
    f.store.guardian_links.push({ ...LINK_ROW });
    await expect(setLinkConsent(f.client, 'link-1', { locationSharingEnabled: true })).rejects.toThrow(
      /only the wearer/,
    );
  });

  it('deleteLink removes the row; throws when nothing was deleted', async () => {
    const f = fakeGatewayClient();
    f.store.guardian_links.push({ ...LINK_ROW });
    await deleteLink(f.client, 'link-1');
    expect(f.store.guardian_links).toHaveLength(0);
    await expect(deleteLink(f.client, 'missing')).rejects.toThrow(GatewayError);
  });
});

describe('guardian_locations (subject key, latitude/longitude)', () => {
  const fix = { lat: 30.05, lng: 31.24, accuracyM: 14, recordedAt: '2026-10-31T10:00:00Z' };

  it('upsertLatestLocation sends the discovered columns on subject_user_id', async () => {
    const f = fakeGatewayClient();
    await upsertLatestLocation(f.client, ME, fix);
    await upsertLatestLocation(f.client, ME, { ...fix, lat: 30.06 });
    expect(f.store.guardian_locations).toHaveLength(1);
    expect(f.store.guardian_locations[0]).toEqual({
      subject_user_id: ME,
      latitude: 30.06,
      longitude: 31.24,
      accuracy_m: 14,
    });
  });

  it('getLatestLocation maps latitude/longitude back to lat/lng; delete works', async () => {
    const f = fakeGatewayClient();
    await expect(getLatestLocation(f.client, ME)).resolves.toBeNull();
    f.store.guardian_locations.push({
      subject_user_id: ME, latitude: 30, longitude: 31, accuracy_m: 9,
      recorded_at: '2026-10-31T10:00:00Z', updated_at: '2026-10-31T10:00:03Z',
    });
    await expect(getLatestLocation(f.client, ME)).resolves.toMatchObject({ lat: 30, lng: 31, accuracyM: 9 });
    await deleteLatestLocation(f.client, ME);
    expect(f.store.guardian_locations).toHaveLength(0);
  });
});

describe('sos_alerts', () => {
  it('insertSosAlert writes subject + latitude/longitude snapshot; bare without a fix', async () => {
    const f = fakeGatewayClient();
    await insertSosAlert(f.client, ME, { lat: 30, lng: 31, accuracyM: 8, recordedAt: 't' });
    await insertSosAlert(f.client, ME, null);
    expect(f.store.sos_alerts[0]).toEqual({ subject_user_id: ME, latitude: 30, longitude: 31, accuracy_m: 8 });
    expect(f.store.sos_alerts[1]).toEqual({ subject_user_id: ME });
  });

  it('listSosAlerts maps triggered_at/status; resolveOwnActiveSosAlerts updates actives', async () => {
    const f = fakeGatewayClient();
    f.store.sos_alerts.push(
      { id: 's1', subject_user_id: 'w1', latitude: 1, longitude: 2, status: 'active', triggered_at: '2026-10-31T10:00:00Z', resolved_at: null },
      { id: 's2', subject_user_id: 'w1', latitude: 3, longitude: 4, status: 'resolved', triggered_at: '2026-10-30T10:00:00Z', resolved_at: '2026-10-30T11:00:00Z' },
    );
    const alerts = await listSosAlerts(f.client, ['w1']);
    expect(alerts[0]).toMatchObject({ id: 's1', status: 'active', createdAt: '2026-10-31T10:00:00Z' });
    await resolveOwnActiveSosAlerts(f.client, 'w1');
    // NOTE: the fake has no subject column named subject_user_id on s-rows? rows carry it — check update applied to the ACTIVE row of w1 only via filters subject+status.
    const updates = f.calls.filter((c) => c.table === 'sos_alerts' && c.op === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toMatchObject({ status: 'resolved' });
  });
});

describe('user_push_tokens (expo_push_token, platform android/ios)', () => {
  it('registerPushToken replaces the previous row and uses expo_push_token', async () => {
    const f = fakeGatewayClient();
    f.store.user_push_tokens.push({ user_id: ME, platform: 'android', expo_push_token: 'ExponentPushToken[old]' });
    await registerPushToken(f.client, ME, 'ExponentPushToken[new]', 'android');
    expect(f.store.user_push_tokens).toHaveLength(1);
    expect(f.store.user_push_tokens[0]).toEqual({
      user_id: ME,
      platform: 'android',
      expo_push_token: 'ExponentPushToken[new]',
    });
  });

  it('removePushTokens deletes by user (and platform when given)', async () => {
    const f = fakeGatewayClient();
    f.store.user_push_tokens.push(
      { user_id: ME, platform: 'android', expo_push_token: 'a' },
      { user_id: ME, platform: 'ios', expo_push_token: 'b' },
      { user_id: 'other', platform: 'android', expo_push_token: 'c' },
    );
    await removePushTokens(f.client, ME, 'android');
    expect(f.store.user_push_tokens).toHaveLength(2);
    await removePushTokens(f.client, ME);
    expect(f.store.user_push_tokens).toEqual([{ user_id: 'other', platform: 'android', expo_push_token: 'c' }]);
  });
});

describe('deleteAllUserData', () => {
  it('removes locations/tokens/links/profile — SOS rows REMAIN (clients cannot delete alerts)', async () => {
    const f = fakeGatewayClient();
    f.store.guardian_locations.push({ subject_user_id: ME, latitude: 1, longitude: 2 });
    f.store.sos_alerts.push({ subject_user_id: ME });
    f.store.user_push_tokens.push({ user_id: ME, platform: 'android', expo_push_token: 'x' });
    f.store.guardian_links.push(
      { ...LINK_ROW },
      { ...LINK_ROW, id: 'link-2', subject_user_id: 'w', guardian_user_id: ME },
    );
    f.store.profiles.push({ id: ME });
    await deleteAllUserData(f.client, ME);
    expect(f.store.guardian_locations).toHaveLength(0);
    expect(f.store.user_push_tokens).toHaveLength(0);
    expect(f.store.guardian_links).toHaveLength(0);
    expect(f.store.profiles).toHaveLength(0);
    // Verified live: sos_alerts has NO client delete policy (append-only
    // safety log) — the cleanup deliberately does not claim otherwise.
    expect(f.store.sos_alerts).toHaveLength(1);
    expect(f.calls.some((c) => c.table === 'sos_alerts' && c.op === 'delete')).toBe(false);
  });
});

describe('realtime subscriptions', () => {
  it('subscribeWearerLocation filters on subject_user_id and maps latitude/longitude payloads', async () => {
    const f = fakeGatewayClient();
    const seen: unknown[] = [];
    const sub = subscribeWearerLocation(f.client, 'w1', (row, ev) => seen.push([row, ev]));
    const handler = f.channels[0].handlers[0];
    expect(handler.filter).toMatchObject({ table: 'guardian_locations', filter: 'subject_user_id=eq.w1' });
    (handler.cb as (p: unknown) => void)({
      eventType: 'UPDATE',
      new: { latitude: 30, longitude: 31, accuracy_m: 5, recorded_at: 't1', updated_at: 't2' },
      old: {},
    });
    expect(seen[0]).toMatchObject([{ lat: 30, lng: 31 }, 'UPDATE']);
    (handler.cb as (p: unknown) => void)({ eventType: 'DELETE', new: null, old: {} });
    expect(seen[1]).toEqual([null, 'DELETE']);
    await sub.unsubscribe();
    expect(f.removedChannels).toHaveLength(1);
  });

  it('subscribeUserLinks binds subject + guardian filters', async () => {
    const f = fakeGatewayClient();
    const sub = subscribeUserLinks(f.client, ME, () => undefined);
    expect(f.channels[0].handlers.map((h) => h.filter.filter)).toEqual([
      `subject_user_id=eq.${ME}`,
      `guardian_user_id=eq.${ME}`,
    ]);
    await sub.unsubscribe();
    expect(f.removedChannels).toHaveLength(1);
  });
});
