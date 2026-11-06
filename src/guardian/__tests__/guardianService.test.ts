/**
 * GuardianService tests — DISCOVERED deployed contract edition.
 *
 * Supersedes the RPC-contract tests AND the short-lived
 * profiles-consent assumption: live discovery (2026-10-31) proved
 * consent is PER-LINK on guardian_links (subject/guardian columns),
 * locations are latitude/longitude keyed by subject_user_id, and
 * pairing returns { link_id, status: 'paired' }. The service is
 * exercised end-to-end (service -> gateway) against a fake
 * supabase-js client; gateway details have their own suite and the
 * live matrix is scripts/live-rls-test.mjs.
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
  private conflictKey = 'id';
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
      const removed = rows.filter((r) => this.matches(r));
      this.tables[this.table] = rows.filter((r) => !this.matches(r));
      return { data: this.returning ? removed : null, error: null };
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

const LINK = {
  id: 'l2',
  subject_user_id: 'me',
  guardian_user_id: 'g1',
  location_sharing_enabled: false,
  sos_sharing_enabled: false,
  consent_version: '1.0',
  created_at: '2026-10-31T09:00:00Z',
  accepted_at: '2026-10-31T09:00:00Z',
};

function fakeClient(opts?: { signUpSession?: boolean }) {
  const tables: Record<string, Row[]> = {
    profiles: [{ id: 'g1', display_name: 'Mum', preferred_language: 'ar' }],
    guardian_links: [
      { ...LINK },
      {
        id: 'l3', subject_user_id: 'wearer-9', guardian_user_id: 'me',
        location_sharing_enabled: true, sos_sharing_enabled: false,
        consent_version: '1.0', created_at: '2026-10-31T08:00:00Z', accepted_at: '2026-10-31T08:00:00Z',
      },
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

describe('SupabaseGuardianService — discovered deployed contract', () => {
  it('signIn ensures the profile exists (no consent fields on profiles)', async () => {
    const { client, tables } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    const user = await svc.signIn('me@example.com', 'pw', 'en');
    expect(user.id).toBe('me');
    expect(tables.profiles.find((p) => p.id === 'me')).toEqual({
      id: 'me',
      display_name: 'me',
      preferred_language: 'en',
    });
  });

  it('signUp WITH a session ensures the profile with the display name', async () => {
    const { client, tables } = fakeClient({ signUpSession: true });
    const svc = new SupabaseGuardianService(client as never);
    const res = await svc.signUp('me@example.com', 'pw', 'Me Myself', 'ar');
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
      data: { invite_code: 'A5F2-99D2', expires_at: '2026-10-31T11:05:41Z' },
      error: null,
    });
    const svc = new SupabaseGuardianService(client as never);
    await expect(svc.createPairingCode('guardian@example.com')).resolves.toEqual({
      code: 'A5F2-99D2',
      expiresAt: '2026-10-31T11:05:41Z',
      invitedEmail: 'guardian@example.com',
      boundToEmail: false,
    });
    expect(invokeCalls[0].name).toBe('create-guardian-invite');
    expect(invokeCalls[0].body).toEqual({ invited_email: 'guardian@example.com' });
  });

  it('createPairingCode rejects a malformed invited email before calling', async () => {
    const { client, invokeCalls } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    await expect(svc.createPairingCode('not-an-email')).rejects.toMatchObject({
      kind: 'invalid-invited-email',
    });
    expect(invokeCalls).toHaveLength(0);
  });

  it('redeemPairingCode returns the paired link id', async () => {
    const { client, invokeResponses, invokeCalls } = fakeClient();
    invokeResponses.set('accept-guardian-invite', {
      data: { link_id: 'link-9', status: 'paired' },
      error: null,
    });
    const svc = new SupabaseGuardianService(client as never);
    await expect(svc.redeemPairingCode('A5F2-99D2')).resolves.toEqual({
      linkId: 'link-9',
      status: 'active',
    });
    expect(invokeCalls[0]).toEqual({
      name: 'accept-guardian-invite',
      body: { invite_code: 'A5F2-99D2' },
    });
  });

  it('redeemPairingCode maps invalid_or_expired_invite to GuardianInviteError', async () => {
    const { client, invokeResponses } = fakeClient();
    invokeResponses.set('accept-guardian-invite', {
      data: null,
      error: {
        message: 'non-2xx',
        context: { json: async () => ({ error: 'invalid_or_expired_invite' }) },
      },
    });
    const svc = new SupabaseGuardianService(client as never);
    await expect(svc.redeemPairingCode('A5F2-99D2')).rejects.toMatchObject({
      name: 'GuardianInviteError',
      kind: 'invalid-or-expired',
    });
    await expect(svc.redeemPairingCode('A5F2-99D2')).rejects.toBeInstanceOf(GuardianInviteError);
  });

  it('lists my guardians AND people I guard, with names + consent flags', async () => {
    const { client } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    const guardians = await svc.listMyGuardians();
    expect(guardians).toHaveLength(1);
    expect(guardians[0].otherPartyName).toBe('Mum');
    expect(guardians[0].locationSharingEnabled).toBe(false);
    const guarding = await svc.listPeopleIGuard();
    expect(guarding).toHaveLength(1);
    expect(guarding[0].ownerId).toBe('wearer-9');
  });

  it('revokeLink deletes the guardian_links row (no RPC, no function call)', async () => {
    const { client, tables, invokeCalls } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    await svc.revokeLink('l2');
    expect(tables.guardian_links.map((l) => l.id)).toEqual(['l3']);
    expect(invokeCalls).toHaveLength(0);
  });

  it('setSharingEnabled fans out to my links; OFF also deletes the stored location', async () => {
    const { client, tables } = fakeClient();
    tables.guardian_locations.push({ subject_user_id: 'me', latitude: 30, longitude: 31 });
    const svc = new SupabaseGuardianService(client as never);
    await svc.setSharingEnabled(true);
    expect(tables.guardian_links.find((l) => l.id === 'l2')?.location_sharing_enabled).toBe(true);
    await svc.setSharingEnabled(false);
    expect(tables.guardian_links.find((l) => l.id === 'l2')?.location_sharing_enabled).toBe(false);
    expect(tables.guardian_locations).toHaveLength(0);
  });

  it('SOS consent is an independent per-link flag; aggregate reflects any-on', async () => {
    const { client, tables } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    await svc.setSosSharingEnabled(true);
    const row = tables.guardian_links.find((l) => l.id === 'l2');
    expect(row?.sos_sharing_enabled).toBe(true);
    expect(row?.location_sharing_enabled).toBe(false);
    await expect(svc.getConsent()).resolves.toEqual({
      locationSharingEnabled: false,
      sosSharingEnabled: true,
    });
    await expect(svc.setLinkConsent('l2', { locationSharingEnabled: true })).resolves.toMatchObject({
      id: 'l2',
      locationSharingEnabled: true,
    });
  });

  it('uploadLocationPoints REFUSES while no link grants location consent', async () => {
    const { client, tables } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    await expect(
      svc.uploadLocationPoints([{ lat: 1, lng: 2, accuracyM: 5, recordedAt: 't' }]),
    ).rejects.toThrow(/consent is off/);
    expect(tables.guardian_locations).toHaveLength(0);
  });

  it('uploadLocationPoints stores ONLY the newest point (latitude/longitude) when consent is on', async () => {
    const { client, tables } = fakeClient();
    tables.guardian_links[0].location_sharing_enabled = true;
    const svc = new SupabaseGuardianService(client as never);
    await svc.uploadLocationPoints([
      { lat: 1, lng: 1, accuracyM: 5, recordedAt: 't1' },
      { lat: 2, lng: 2, accuracyM: 6, recordedAt: 't2' },
      { lat: 3, lng: 3, accuracyM: 7, recordedAt: 't3' },
    ]);
    expect(tables.guardian_locations).toHaveLength(1);
    expect(tables.guardian_locations[0]).toEqual({
      subject_user_id: 'me',
      latitude: 3,
      longitude: 3,
      accuracy_m: 7,
    });
  });

  it('getLatestLocation reads guardian_locations', async () => {
    const { client, tables } = fakeClient();
    tables.guardian_locations.push({
      subject_user_id: 'wearer-9', latitude: 30.1, longitude: 31.3, accuracy_m: 11,
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
    await expect(svc.createPairingCode('g@example.com')).rejects.toBeInstanceOf(GuardianNotConfiguredError);
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
