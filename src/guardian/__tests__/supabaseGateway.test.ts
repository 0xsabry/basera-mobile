/**
 * supabaseGateway tests — the DEPLOYED contract (owner's project):
 * Edge-Function pairing, profiles consent, latest-only locations,
 * sos_alerts, user_push_tokens, realtime wiring. Runs against a fake
 * supabase-js-shaped client; the LIVE matrix is
 * scripts/live-rls-test.mjs (needs confirmed test accounts).
 */
import {
  acceptInvite,
  createInvite,
  classifyInviteErrorMessage,
  deleteAllUserData,
  deleteLatestLocation,
  ensureProfile,
  getConsent,
  getLatestLocation,
  insertSosAlert,
  listLinksAsGuardian,
  listLinksAsOwner,
  listSosAlerts,
  parseInvitePayload,
  registerPushToken,
  removePushTokens,
  subscribeUserLinks,
  subscribeWearerLocation,
  updateConsent,
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
    if (this.op === 'update' || this.op === 'insert') this.returning = true;
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
        this.store[this.table] = rows.filter((r) => !this.matches(r));
        return { data: null, error: null };
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

describe('invite payload parsing + error classification', () => {
  it('parses invite_code + expires_at at top level and nested', () => {
    expect(parseInvitePayload({ invite_code: '847201', expires_at: '2026-10-31T13:00:00Z' })).toEqual({
      code: '847201',
      expiresAt: '2026-10-31T13:00:00Z',
    });
    expect(parseInvitePayload({ data: { code: 'XY29KD', expiry: 'soon' } }).code).toBe('XY29KD');
    expect(() => parseInvitePayload({ ok: true })).toThrow(GatewayError);
  });

  it('classifies function error messages into honest kinds', () => {
    expect(classifyInviteErrorMessage('invite code has expired')).toBe('expired');
    expect(classifyInviteErrorMessage('code already used')).toBe('already-used');
    expect(classifyInviteErrorMessage('you cannot pair with your own code')).toBe('self-pairing');
    expect(classifyInviteErrorMessage('invalid invite code')).toBe('invalid');
    expect(classifyInviteErrorMessage('Failed to fetch')).toBe('network');
    expect(classifyInviteErrorMessage('something else')).toBe('unknown');
  });
});

describe('pairing via Edge Functions', () => {
  it('createInvite invokes create-guardian-invite and maps the payload', async () => {
    const f = fakeGatewayClient();
    f.invokeResponses.set('create-guardian-invite', {
      data: { invite_code: '555123', expires_at: '2026-10-31T13:15:00Z' },
      error: null,
    });
    const invite = await createInvite(f.client);
    expect(invite).toEqual({ code: '555123', expiresAt: '2026-10-31T13:15:00Z' });
    expect(f.invokeCalls[0].name).toBe('create-guardian-invite');
  });

  it('acceptInvite posts { invite_code } to accept-guardian-invite', async () => {
    const f = fakeGatewayClient();
    f.invokeResponses.set('accept-guardian-invite', {
      data: { owner_id: 'wearer-1', link_id: 'link-1' },
      error: null,
    });
    const res = await acceptInvite(f.client, '555123');
    expect(res).toEqual({ ownerId: 'wearer-1', linkId: 'link-1' });
    expect(f.invokeCalls[0]).toEqual({
      name: 'accept-guardian-invite',
      body: { invite_code: '555123' },
    });
  });

  it('acceptInvite surfaces the function body error (expired) with its kind', async () => {
    const f = fakeGatewayClient();
    f.invokeResponses.set('accept-guardian-invite', {
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: async () => ({ error: 'This invite code has expired' }),
        },
      },
    });
    await expect(acceptInvite(f.client, '555123')).rejects.toMatchObject({
      name: 'GatewayError',
      kind: 'expired',
      message: 'This invite code has expired',
    });
  });
});

describe('profiles + consent', () => {
  it('ensureProfile inserts a new profile with BOTH consents false', async () => {
    const f = fakeGatewayClient();
    const profile = await ensureProfile(f.client, { id: ME, email: 'me@example.com' });
    expect(profile.consent).toEqual({ locationSharingEnabled: false, sosSharingEnabled: false });
    expect(f.store.profiles).toHaveLength(1);
    expect(f.store.profiles[0]).toMatchObject({
      id: ME,
      location_sharing_enabled: false,
      sos_sharing_enabled: false,
    });
  });

  it('ensureProfile NEVER resets an existing profile consent', async () => {
    const f = fakeGatewayClient();
    f.store.profiles.push({
      id: ME,
      display_name: 'Me',
      location_sharing_enabled: true,
      sos_sharing_enabled: true,
    });
    const profile = await ensureProfile(f.client, { id: ME, email: 'me@example.com' });
    expect(profile.consent).toEqual({ locationSharingEnabled: true, sosSharingEnabled: true });
    expect(f.calls.some((c) => c.op === 'insert' || c.op === 'upsert')).toBe(false);
  });

  it('getConsent defaults to both false when no profile row exists', async () => {
    const f = fakeGatewayClient();
    await expect(getConsent(f.client, ME)).resolves.toEqual({
      locationSharingEnabled: false,
      sosSharingEnabled: false,
    });
  });

  it('updateConsent updates one flag without clobbering the other', async () => {
    const f = fakeGatewayClient();
    f.store.profiles.push({
      id: ME,
      display_name: null,
      location_sharing_enabled: true,
      sos_sharing_enabled: false,
    });
    const next = await updateConsent(f.client, ME, { sosSharingEnabled: true });
    expect(next).toEqual({ locationSharingEnabled: true, sosSharingEnabled: true });
    expect(f.store.profiles[0]).toMatchObject({
      location_sharing_enabled: true,
      sos_sharing_enabled: true,
    });
  });

  it('updateConsent creates the profile (defaults + patch) when missing', async () => {
    const f = fakeGatewayClient();
    const next = await updateConsent(f.client, ME, { locationSharingEnabled: true });
    expect(next.locationSharingEnabled).toBe(true);
    expect(next.sosSharingEnabled).toBe(false);
    expect(f.store.profiles).toHaveLength(1);
  });
});

describe('links', () => {
  it('lists owner/guardian links, hides revoked, defaults missing status to active', async () => {
    const f = fakeGatewayClient();
    f.store.guardian_links.push(
      { id: 'l1', owner_id: ME, guardian_id: 'g1', status: 'active', created_at: '2026-10-31T10:00:00Z' },
      { id: 'l2', owner_id: ME, guardian_id: 'g2', status: 'revoked', created_at: '2026-10-30T10:00:00Z' },
      { id: 'l3', owner_id: 'w1', guardian_id: ME, created_at: '2026-10-31T09:00:00Z' },
    );
    const mine = await listLinksAsOwner(f.client, ME);
    expect(mine.map((l) => l.id)).toEqual(['l1']);
    const guarding = await listLinksAsGuardian(f.client, ME);
    expect(guarding).toHaveLength(1);
    expect(guarding[0].status).toBe('active'); // no status column value -> active
    expect(guarding[0].ownerId).toBe('w1');
  });

  it('retries the link select WITHOUT status when the column is absent', async () => {
    const f = fakeGatewayClient((call) => {
      if (call.table === 'guardian_links' && call.op === 'select' && call.selectCols?.includes('status')) {
        return { data: null, error: { message: "column guardian_links.status does not exist" } };
      }
      return undefined;
    });
    f.store.guardian_links.push({ id: 'l1', owner_id: ME, guardian_id: 'g1', created_at: 'x' });
    const links = await listLinksAsOwner(f.client, ME);
    expect(links).toHaveLength(1);
    expect(f.calls.filter((c) => c.op === 'select')).toHaveLength(2);
  });
});

describe('locations (latest-only)', () => {
  const fix = { lat: 30.05, lng: 31.24, accuracyM: 14, recordedAt: '2026-10-31T10:00:00Z' };

  it('upsertLatestLocation upserts on the wearer key with the fix fields', async () => {
    const f = fakeGatewayClient();
    await upsertLatestLocation(f.client, ME, fix);
    await upsertLatestLocation(f.client, ME, { ...fix, lat: 30.06 });
    expect(f.store.guardian_locations).toHaveLength(1); // still ONE row
    expect(f.store.guardian_locations[0]).toMatchObject({ user_id: ME, lat: 30.06, lng: 31.24 });
    const upserts = f.calls.filter((c) => c.op === 'upsert');
    expect(upserts[0].payload).toMatchObject({ recorded_at: fix.recordedAt, accuracy_m: 14 });
  });

  it('upsert drops an optional column PostgREST reports missing and retries', async () => {
    const f = fakeGatewayClient((call) => {
      const payload = call.payload as Row | undefined;
      if (call.table === 'guardian_locations' && call.op === 'upsert' && payload && 'recorded_at' in payload) {
        return {
          data: null,
          error: { message: "Could not find the 'recorded_at' column of 'guardian_locations' in the schema cache" },
        };
      }
      return undefined;
    });
    await upsertLatestLocation(f.client, ME, fix);
    expect(f.store.guardian_locations).toHaveLength(1);
    expect(f.store.guardian_locations[0]).not.toHaveProperty('recorded_at');
  });

  it('deleteLatestLocation removes only the wearer row', async () => {
    const f = fakeGatewayClient();
    f.store.guardian_locations.push(
      { user_id: ME, lat: 1, lng: 2 },
      { user_id: 'other', lat: 3, lng: 4 },
    );
    await deleteLatestLocation(f.client, ME);
    expect(f.store.guardian_locations).toEqual([{ user_id: 'other', lat: 3, lng: 4 }]);
  });

  it('getLatestLocation maps the row, null when absent', async () => {
    const f = fakeGatewayClient();
    await expect(getLatestLocation(f.client, ME)).resolves.toBeNull();
    f.store.guardian_locations.push({
      user_id: ME, lat: 30, lng: 31, accuracy_m: 9,
      recorded_at: '2026-10-31T10:00:00Z', updated_at: '2026-10-31T10:00:03Z',
    });
    await expect(getLatestLocation(f.client, ME)).resolves.toMatchObject({ lat: 30, accuracyM: 9 });
  });
});

describe('sos_alerts', () => {
  it('insertSosAlert writes wearer + snapshot; bare insert without a fix', async () => {
    const f = fakeGatewayClient();
    await insertSosAlert(f.client, ME, { lat: 30, lng: 31, accuracyM: 8, recordedAt: 't' });
    await insertSosAlert(f.client, ME, null);
    expect(f.store.sos_alerts).toHaveLength(2);
    expect(f.store.sos_alerts[0]).toMatchObject({ user_id: ME, lat: 30, lng: 31, accuracy_m: 8 });
    expect(f.store.sos_alerts[1]).toEqual({ user_id: ME });
  });

  it('listSosAlerts maps rows for the given wearers', async () => {
    const f = fakeGatewayClient();
    f.store.sos_alerts.push(
      { id: 's1', user_id: 'w1', lat: 1, lng: 2, created_at: '2026-10-31T10:00:00Z' },
      { id: 's2', user_id: 'stranger', lat: 3, lng: 4, created_at: '2026-10-31T10:01:00Z' },
    );
    const alerts = await listSosAlerts(f.client, ['w1']);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ id: 's1', userId: 'w1' });
  });
});

describe('user_push_tokens (registration only)', () => {
  it('registerPushToken replaces the previous row for the platform', async () => {
    const f = fakeGatewayClient();
    f.store.user_push_tokens.push({ user_id: ME, platform: 'android-expo', token: 'ExponentPushToken[old]' });
    await registerPushToken(f.client, ME, 'ExponentPushToken[new]', 'android-expo');
    expect(f.store.user_push_tokens).toHaveLength(1);
    expect(f.store.user_push_tokens[0]).toMatchObject({ token: 'ExponentPushToken[new]' });
  });

  it('registerPushToken falls back to the endpoint column when token is absent', async () => {
    const f = fakeGatewayClient((call) => {
      const payload = call.payload as Row | undefined;
      if (call.table === 'user_push_tokens' && call.op === 'insert' && payload && 'token' in payload) {
        return { data: null, error: { message: "column \"token\" does not exist" } };
      }
      return undefined;
    });
    await registerPushToken(f.client, ME, 'tok-1', 'android-expo');
    expect(f.store.user_push_tokens[0]).toMatchObject({ endpoint: 'tok-1' });
  });

  it('removePushTokens deletes by user (and platform when given)', async () => {
    const f = fakeGatewayClient();
    f.store.user_push_tokens.push(
      { user_id: ME, platform: 'android-expo', token: 'a' },
      { user_id: ME, platform: 'web-fcm', token: 'b' },
      { user_id: 'other', platform: 'android-expo', token: 'c' },
    );
    await removePushTokens(f.client, ME, 'android-expo');
    expect(f.store.user_push_tokens).toHaveLength(2);
    await removePushTokens(f.client, ME);
    expect(f.store.user_push_tokens).toEqual([{ user_id: 'other', platform: 'android-expo', token: 'c' }]);
  });
});

describe('deleteAllUserData', () => {
  it('removes the user rows from every deployed table + profile', async () => {
    const f = fakeGatewayClient();
    f.store.guardian_locations.push({ user_id: ME, lat: 1, lng: 2 });
    f.store.sos_alerts.push({ user_id: ME });
    f.store.user_push_tokens.push({ user_id: ME, platform: 'android-expo', token: 'x' });
    f.store.guardian_links.push(
      { id: 'l1', owner_id: ME, guardian_id: 'g' },
      { id: 'l2', owner_id: 'w', guardian_id: ME },
    );
    f.store.profiles.push({ id: ME });
    await deleteAllUserData(f.client, ME);
    expect(f.store.guardian_locations).toHaveLength(0);
    expect(f.store.sos_alerts).toHaveLength(0);
    expect(f.store.user_push_tokens).toHaveLength(0);
    expect(f.store.guardian_links).toHaveLength(0);
    expect(f.store.profiles).toHaveLength(0);
  });
});

describe('realtime subscriptions', () => {
  it('subscribeWearerLocation wires postgres_changes with the wearer filter and maps payloads', async () => {
    const f = fakeGatewayClient();
    const seen: unknown[] = [];
    const sub = subscribeWearerLocation(f.client, 'w1', (row, ev) => seen.push([row, ev]));
    expect(f.channels).toHaveLength(1);
    const handler = f.channels[0].handlers[0];
    expect(handler.filter).toMatchObject({ table: 'guardian_locations', filter: 'user_id=eq.w1' });
    (handler.cb as (p: unknown) => void)({
      eventType: 'UPDATE',
      new: { lat: 30, lng: 31, accuracy_m: 5, recorded_at: 't1', updated_at: 't2' },
      old: {},
    });
    expect(seen[0]).toMatchObject([{ lat: 30, lng: 31 }, 'UPDATE']);
    (handler.cb as (p: unknown) => void)({ eventType: 'DELETE', new: null, old: {} });
    expect(seen[1]).toEqual([null, 'DELETE']);
    await sub.unsubscribe();
    expect(f.removedChannels).toHaveLength(1);
  });

  it('subscribeUserLinks binds both roles on guardian_links', async () => {
    const f = fakeGatewayClient();
    const sub = subscribeUserLinks(f.client, ME, () => undefined);
    expect(f.channels[0].handlers.map((h) => h.filter.filter)).toEqual([
      `owner_id=eq.${ME}`,
      `guardian_id=eq.${ME}`,
    ]);
    await sub.unsubscribe();
    expect(f.removedChannels).toHaveLength(1);
  });
});
