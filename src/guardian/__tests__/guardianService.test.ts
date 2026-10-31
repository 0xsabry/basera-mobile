/**
 * GuardianService tests — DEPLOYED contract edition.
 *
 * Updated from the old RPC-contract tests (create_pairing_code /
 * redeem_pairing_code / approve_link / set_sharing_enabled /
 * location_points / latest_locations): the deployed project pairs via
 * Edge Functions, consent lives on profiles, and guardian_locations is
 * latest-only. See docs/SUPABASE_INTEGRATION.md for the change log.
 * The service is exercised end-to-end (service -> gateway) against a
 * fake supabase-js client; gateway details have their own suite.
 */
import {
  GuardianInviteError,
  GuardianNotConfiguredError,
  NotConfiguredGuardianService,
  SupabaseGuardianService,
} from '../GuardianService';
import { readGuardianConfig } from '../supabaseClient';

type Row = Record<string, unknown>;

class FakeQuery {
  private rows: Row[];
  private op = 'select';
  private payload: unknown = null;
  private filters: [string, unknown][] = [];
  private returning = false;
  constructor(
    private tables: Record<string, Row[]>,
    private table: string,
  ) {
    this.rows = tables[table] ?? (tables[table] = []);
  }
  select() {
    if (this.op !== 'select') this.returning = true;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push([col, vals]);
    return this;
  }
  order() {
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
    this.conflictKey = opts?.onConflict ?? 'id';
    return this;
  }
  private conflictKey = 'id';
  update(fields: unknown) {
    this.op = 'update';
    this.payload = fields;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  private matches(r: Row) {
    return this.filters.every(([c, v]) =>
      Array.isArray(v) ? (v as unknown[]).includes(r[c]) : r[c] === v,
    );
  }
  private exec() {
    const rows = this.rows;
    if (this.op === 'select') {
      return { data: rows.filter((r) => this.matches(r)).map((r) => ({ ...r })), error: null };
    }
    if (this.op === 'insert') {
      const inc = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      rows.push(...inc.map((r) => ({ ...r })));
      return { data: null, error: null };
    }
    if (this.op === 'upsert') {
      const inc = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      for (const r of inc) {
        const i = rows.findIndex((x) => x[this.conflictKey] === r[this.conflictKey]);
        if (i >= 0) rows[i] = { ...rows[i], ...r };
        else rows.push({ ...r });
      }
      return { data: null, error: null };
    }
    if (this.op === 'update') {
      const updated: Row[] = [];
      for (const r of rows) {
        if (this.matches(r)) {
          Object.assign(r, this.payload as Row);
          updated.push({ ...r });
        }
      }
      return { data: this.returning ? updated : null, error: null };
    }
    if (this.op === 'delete') {
      this.tables[this.table] = rows.filter((r) => !this.matches(r));
      return { data: null, error: null };
    }
    return { data: null, error: null };
  }
  maybeSingle() {
    const res = this.exec();
    const arr = Array.isArray(res.data) ? res.data : [];
    return Promise.resolve({ data: arr[0] ?? null, error: null });
  }
  then(resolve: (v: { data: unknown; error: null }) => void) {
    resolve(this.exec() as { data: unknown; error: null });
  }
}

function fakeClient(opts?: { signUpSession?: boolean }) {
  const tables: Record<string, Row[]> = {
    profiles: [{ id: 'g1', display_name: 'Mum', location_sharing_enabled: false, sos_sharing_enabled: false }],
    guardian_links: [
      { id: 'l2', owner_id: 'me', guardian_id: 'g1', status: 'active', created_at: '2026-10-31T09:00:00Z' },
      { id: 'l3', owner_id: 'wearer-9', guardian_id: 'me', status: 'active', created_at: '2026-10-31T08:00:00Z' },
    ],
    guardian_locations: [],
    sos_alerts: [],
    user_push_tokens: [],
  };
  const invokeCalls: { name: string; body?: unknown }[] = [];
  const invokeResponses = new Map<string, { data: unknown; error: unknown }>();
  const withSession = opts?.signUpSession ?? true;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'me', email: 'me@example.com' } } }),
      signInWithPassword: async () => ({
        data: { user: { id: 'me', email: 'me@example.com' }, session: { access_token: 'x' } },
        error: null,
      }),
      signUp: async () => ({
        data: {
          user: { id: 'me', email: 'me@example.com' },
          session: withSession ? { access_token: 'x' } : null,
        },
        error: null,
      }),
      signOut: async () => ({ error: null }),
    },
    functions: {
      invoke: async (name: string, options?: { body?: unknown }) => {
        invokeCalls.push({ name, body: options?.body });
        return invokeResponses.get(name) ?? { data: null, error: null };
      },
    },
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: async () => 'ok',
    from: (table: string) => new FakeQuery(tables, table),
  };
  return { client, tables, invokeCalls, invokeResponses };
}

describe('SupabaseGuardianService — deployed contract', () => {
  it('signIn ensures the profile exists (created with consents OFF)', async () => {
    const { client, tables } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    const user = await svc.signIn('me@example.com', 'pw');
    expect(user.id).toBe('me');
    expect(tables.profiles.find((p) => p.id === 'me')).toMatchObject({
      location_sharing_enabled: false,
      sos_sharing_enabled: false,
    });
  });

  it('signUp WITH a session ensures the profile and reports no confirmation wait', async () => {
    const { client, tables } = fakeClient({ signUpSession: true });
    const svc = new SupabaseGuardianService(client as never);
    const res = await svc.signUp('me@example.com', 'pw', 'Me Myself');
    expect(res.needsConfirmation).toBe(false);
    expect(tables.profiles.find((p) => p.id === 'me')?.display_name).toBe('Me Myself');
  });

  it('signUp WITHOUT a session reports needsConfirmation and writes nothing', async () => {
    const { client, tables } = fakeClient({ signUpSession: false });
    const svc = new SupabaseGuardianService(client as never);
    const res = await svc.signUp('me@example.com', 'pw');
    expect(res).toMatchObject({ needsConfirmation: true });
    expect(res.user?.id).toBe('me');
    expect(tables.profiles.find((p) => p.id === 'me')).toBeUndefined();
  });

  it('createPairingCode goes through create-guardian-invite', async () => {
    const { client, invokeResponses, invokeCalls } = fakeClient();
    invokeResponses.set('create-guardian-invite', {
      data: { invite_code: '99120', expires_at: '2026-10-31T13:00:00Z' },
      error: null,
    });
    const svc = new SupabaseGuardianService(client as never);
    await expect(svc.createPairingCode()).resolves.toEqual({
      code: '99120',
      expiresAt: '2026-10-31T13:00:00Z',
    });
    expect(invokeCalls[0].name).toBe('create-guardian-invite');
  });

  it('redeemPairingCode returns an ACTIVE link (no approval step exists)', async () => {
    const { client, invokeResponses, invokeCalls } = fakeClient();
    invokeResponses.set('accept-guardian-invite', {
      data: { owner_id: 'wearer-9' },
      error: null,
    });
    const svc = new SupabaseGuardianService(client as never);
    await expect(svc.redeemPairingCode('99120')).resolves.toEqual({
      ownerId: 'wearer-9',
      status: 'active',
    });
    expect(invokeCalls[0]).toEqual({
      name: 'accept-guardian-invite',
      body: { invite_code: '99120' },
    });
  });

  it('redeemPairingCode maps an expired-code failure to GuardianInviteError', async () => {
    const { client, invokeResponses } = fakeClient();
    invokeResponses.set('accept-guardian-invite', {
      data: null,
      error: {
        message: 'non-2xx',
        context: { json: async () => ({ error: 'invite code expired' }) },
      },
    });
    const svc = new SupabaseGuardianService(client as never);
    await expect(svc.redeemPairingCode('99120')).rejects.toMatchObject({
      name: 'GuardianInviteError',
      kind: 'expired',
    });
    await expect(svc.redeemPairingCode('99120')).rejects.toBeInstanceOf(GuardianInviteError);
  });

  it('lists my guardians AND people I guard, with display names', async () => {
    const { client } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    const guardians = await svc.listMyGuardians();
    expect(guardians).toHaveLength(1);
    expect(guardians[0].otherPartyName).toBe('Mum');
    const guarding = await svc.listPeopleIGuard();
    expect(guarding).toHaveLength(1);
    expect(guarding[0].ownerId).toBe('wearer-9');
  });

  it('revokeLink deletes the guardian_links row (no RPC)', async () => {
    const { client, tables, invokeCalls } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    await svc.revokeLink('l2');
    expect(tables.guardian_links.map((l) => l.id)).toEqual(['l3']);
    expect(invokeCalls).toHaveLength(0);
  });

  it('setSharingEnabled persists profile consent; OFF also deletes the stored location', async () => {
    const { client, tables } = fakeClient();
    tables.profiles.push({ id: 'me', display_name: null, location_sharing_enabled: true, sos_sharing_enabled: false });
    tables.guardian_locations.push({ user_id: 'me', lat: 30, lng: 31 });
    const svc = new SupabaseGuardianService(client as never);
    await svc.setSharingEnabled(false);
    expect(tables.profiles.find((p) => p.id === 'me')?.location_sharing_enabled).toBe(false);
    expect(tables.guardian_locations).toHaveLength(0);
    await svc.setSharingEnabled(true);
    expect(tables.profiles.find((p) => p.id === 'me')?.location_sharing_enabled).toBe(true);
  });

  it('SOS consent is an independent profile flag', async () => {
    const { client, tables } = fakeClient();
    tables.profiles.push({ id: 'me', display_name: null, location_sharing_enabled: false, sos_sharing_enabled: false });
    const svc = new SupabaseGuardianService(client as never);
    await svc.setSosSharingEnabled(true);
    const row = tables.profiles.find((p) => p.id === 'me');
    expect(row?.sos_sharing_enabled).toBe(true);
    expect(row?.location_sharing_enabled).toBe(false);
    await expect(svc.getConsent()).resolves.toEqual({
      locationSharingEnabled: false,
      sosSharingEnabled: true,
    });
  });

  it('uploadLocationPoints REFUSES while consent is off', async () => {
    const { client, tables } = fakeClient();
    tables.profiles.push({ id: 'me', display_name: null, location_sharing_enabled: false, sos_sharing_enabled: false });
    const svc = new SupabaseGuardianService(client as never);
    await expect(
      svc.uploadLocationPoints([{ lat: 1, lng: 2, accuracyM: 5, recordedAt: 't' }]),
    ).rejects.toThrow(/consent is off/);
    expect(tables.guardian_locations).toHaveLength(0);
  });

  it('uploadLocationPoints stores ONLY the newest point when consent is on', async () => {
    const { client, tables } = fakeClient();
    tables.profiles.push({ id: 'me', display_name: null, location_sharing_enabled: true, sos_sharing_enabled: false });
    const svc = new SupabaseGuardianService(client as never);
    await svc.uploadLocationPoints([
      { lat: 1, lng: 1, accuracyM: 5, recordedAt: 't1' },
      { lat: 2, lng: 2, accuracyM: 6, recordedAt: 't2' },
      { lat: 3, lng: 3, accuracyM: 7, recordedAt: 't3' },
    ]);
    expect(tables.guardian_locations).toHaveLength(1);
    expect(tables.guardian_locations[0]).toMatchObject({ user_id: 'me', lat: 3, lng: 3 });
  });

  it('getLatestLocation reads guardian_locations', async () => {
    const { client, tables } = fakeClient();
    tables.guardian_locations.push({
      user_id: 'wearer-9', lat: 30.1, lng: 31.3, accuracy_m: 11,
      recorded_at: '2026-10-31T10:00:00Z', updated_at: '2026-10-31T10:00:02Z',
    });
    const svc = new SupabaseGuardianService(client as never);
    await expect(svc.getLatestLocation('wearer-9')).resolves.toMatchObject({ lat: 30.1, accuracyM: 11 });
    await expect(svc.getLatestLocation('nobody')).resolves.toBeNull();
  });
});

describe('NotConfiguredGuardianService', () => {
  it('reports unconfigured and throws the typed error on mutations', async () => {
    const svc = new NotConfiguredGuardianService();
    expect(svc.isConfigured()).toBe(false);
    expect(await svc.getCurrentUser()).toBeNull();
    expect(await svc.listMyGuardians()).toEqual([]);
    expect(await svc.getConsent()).toEqual({
      locationSharingEnabled: false,
      sosSharingEnabled: false,
    });
    await expect(svc.createPairingCode()).rejects.toBeInstanceOf(GuardianNotConfiguredError);
    await expect(svc.setSharingEnabled(true)).rejects.toBeInstanceOf(GuardianNotConfiguredError);
  });
});

describe('readGuardianConfig', () => {
  it('returns null without url/key, accepts env, rejects non-https', () => {
    expect(readGuardianConfig({}, {})).toBeNull();
    expect(
      readGuardianConfig(
        { EXPO_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
        {},
      ),
    ).toEqual({ url: 'https://x.supabase.co', anonKey: 'anon' });
    expect(
      readGuardianConfig(
        { EXPO_PUBLIC_SUPABASE_URL: 'http://insecure', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon' },
        {},
      ),
    ).toBeNull();
  });
});
