/**
 * GuardianService tests: SupabaseGuardianService against a fake client
 * (asserts the exact RPC/table contract the SQL migrations implement) and
 * the NotConfigured stub the app uses until the owner creates the project.
 */
import {
  GuardianNotConfiguredError,
  NotConfiguredGuardianService,
  SupabaseGuardianService,
} from '../GuardianService';
import { readGuardianConfig } from '../supabaseClient';

type Row = Record<string, unknown>;

class FakeQuery {
  private rows: Row[];
  constructor(
    private tables: Record<string, Row[]>,
    private table: string,
  ) {
    this.rows = [...(tables[table] ?? [])];
  }
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.rows = this.rows.filter((r) => vals.includes(r[col]));
    return this;
  }
  order() {
    return this;
  }
  insert(rows: Row[]) {
    (this.tables[this.table] ??= []).push(...rows);
    return Promise.resolve({ data: null, error: null });
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null });
  }
  then(resolve: (v: { data: Row[]; error: null }) => void) {
    resolve({ data: this.rows, error: null });
  }
}

function fakeClient() {
  const tables: Record<string, Row[]> = {
    guardian_links: [
      { id: 'l1', owner_id: 'me', guardian_id: 'g1', status: 'pending', created_at: '2026-10-30T10:00:00Z' },
      { id: 'l2', owner_id: 'me', guardian_id: 'g2', status: 'active', created_at: '2026-10-29T10:00:00Z' },
      { id: 'l3', owner_id: 'someone-else', guardian_id: 'me', status: 'active', created_at: '2026-10-29T10:00:00Z' },
    ],
    profiles: [
      { id: 'g1', display_name: 'Mum' },
      { id: 'g2', display_name: null },
    ],
    location_points: [],
    latest_locations: [
      { user_id: 'me', lat: 30.0, lng: 31.2, accuracy_m: 12, recorded_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:00:05Z' },
    ],
  };
  const rpcCalls: { name: string; args?: unknown }[] = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'me', email: 'me@example.com' } } }),
      signInWithPassword: async () => ({ data: { user: { id: 'me', email: 'me@example.com' } }, error: null }),
      signUp: async () => ({ data: { user: { id: 'me', email: 'me@example.com' } }, error: null }),
      signOut: async () => ({ error: null }),
    },
    rpc: async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      if (name === 'create_pairing_code') {
        return { data: { code: '123456', expires_at: '2026-10-30T10:15:00Z' }, error: null };
      }
      if (name === 'redeem_pairing_code') {
        return { data: { owner_id: 'owner-9', status: 'pending' }, error: null };
      }
      return { data: null, error: null };
    },
    from: (table: string) => new FakeQuery(tables, table),
  };
  return { client, tables, rpcCalls };
}

describe('SupabaseGuardianService', () => {
  it('createPairingCode maps the RPC payload', async () => {
    const { client, rpcCalls } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    const code = await svc.createPairingCode();
    expect(code).toEqual({ code: '123456', expiresAt: '2026-10-30T10:15:00Z' });
    expect(rpcCalls[0].name).toBe('create_pairing_code');
  });

  it('redeemPairingCode returns a PENDING link (never active by itself)', async () => {
    const { client, rpcCalls } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    const res = await svc.redeemPairingCode('123456');
    expect(res).toEqual({ ownerId: 'owner-9', status: 'pending' });
    expect(rpcCalls[0]).toEqual({ name: 'redeem_pairing_code', args: { p_code: '123456' } });
  });

  it('lists only MY pending requests and MY active guardians, with names', async () => {
    const { client } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    const pending = await svc.listPendingRequests();
    expect(pending).toHaveLength(1);
    expect(pending[0].otherPartyName).toBe('Mum');
    const active = await svc.listMyGuardians();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('l2');
  });

  it('approve/revoke go through the enforcing RPCs', async () => {
    const { client, rpcCalls } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    await svc.approveLink('l1');
    await svc.revokeLink('l2');
    expect(rpcCalls.map((c) => c.name)).toEqual(['approve_link', 'revoke_link']);
  });

  it('uploadLocationPoints stamps the caller id and foreground source', async () => {
    const { client, tables } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    await svc.uploadLocationPoints([
      { lat: 30.1, lng: 31.3, accuracyM: 9, recordedAt: '2026-10-30T10:01:00Z' },
    ]);
    expect(tables.location_points).toHaveLength(1);
    expect(tables.location_points[0]).toMatchObject({ user_id: 'me', source: 'foreground', lat: 30.1 });
  });

  it('setSharingEnabled(false) goes to the purge RPC', async () => {
    const { client, rpcCalls } = fakeClient();
    const svc = new SupabaseGuardianService(client as never);
    await svc.setSharingEnabled(false);
    expect(rpcCalls[0]).toEqual({ name: 'set_sharing_enabled', args: { p_enabled: false } });
  });
});

describe('NotConfiguredGuardianService', () => {
  it('reports unconfigured and throws the typed error on mutations', async () => {
    const svc = new NotConfiguredGuardianService();
    expect(svc.isConfigured()).toBe(false);
    expect(await svc.getCurrentUser()).toBeNull();
    expect(await svc.listMyGuardians()).toEqual([]);
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
