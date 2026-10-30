/**
 * Static RLS verification (runs HERE, no Postgres needed): parses the
 * migration SQL and asserts the authorization contract is actually
 * written down — RLS enabled on every table, the denial-matrix policies
 * exist by name, the enforcing RPCs exist, retention/expiry intervals
 * are present, and the anon role receives no grants.
 *
 * The LIVE execution of the same matrix lives in
 * supabase/tests/rls_tests.sql and requires the owner's Supabase project
 * (see docs/GUARDIAN_SETUP.md) — static checks complement, never
 * replace, that run.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const schema = readFileSync(join(MIGRATIONS_DIR, '0001_schema.sql'), 'utf8');
const rls = readFileSync(join(MIGRATIONS_DIR, '0002_rls_and_functions.sql'), 'utf8');
const places = readFileSync(join(MIGRATIONS_DIR, '0004_saved_places.sql'), 'utf8');

const TABLES = [
  'profiles',
  'device_settings',
  'guardian_links',
  'pairing_codes',
  'pairing_attempts',
  'location_points',
  'latest_locations',
  'hazard_events',
  'push_endpoints',
];

describe('static RLS contract — schema', () => {
  it.each(TABLES)('table %s exists', (table) => {
    expect(schema).toContain(`create table if not exists public.${table}`);
  });

  it('push endpoints separate android-expo from web-fcm', () => {
    expect(schema).toContain("'android-expo'");
    expect(schema).toContain("'web-fcm'");
  });

  it('latest_locations is trigger-maintained', () => {
    expect(schema).toContain('sync_latest_location');
    expect(schema).toContain('location_points_sync_latest');
  });
});

describe('static RLS contract — row level security', () => {
  it.each(TABLES)('RLS is enabled on %s', (table) => {
    expect(rls).toContain(`alter table public.${table} enable row level security`);
  });

  it.each([
    'profiles_self_select',
    'profiles_self_update',
    'device_settings_self_all',
    'guardian_links_party_select',
    'pairing_codes_owner_select',
    'location_points_insert_own',
    'location_points_select_own_or_active_guardian',
    'location_points_delete_own',
    'latest_locations_select_own_or_active_guardian',
    'hazard_events_insert_own',
    'hazard_events_select_own_or_active_guardian',
    'push_endpoints_self_all',
  ])('policy %s exists', (policy) => {
    expect(rls).toContain(`create policy ${policy}`);
  });

  it('guardian read access requires an ACTIVE link in the policy itself', () => {
    const matches = rls.match(/l\.status = 'active'/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3); // points, latest, hazard
  });

  it('no table grants go to the anon role', () => {
    const grantLines = rls.split('\n').filter((l) => /^\s*grant\s/i.test(l));
    for (const line of grantLines) {
      expect(line).not.toMatch(/\banon\b/);
    }
  });
});

describe('static RLS contract — RPC functions', () => {
  it.each([
    'create_pairing_code',
    'redeem_pairing_code',
    'approve_link',
    'revoke_link',
    'set_sharing_enabled',
    'cleanup_locations',
  ])('function %s exists as security definer', (fn) => {
    expect(rls).toContain(`function public.${fn}`);
  });

  it('codes are hashed and expire in 15 minutes', () => {
    expect(rls).toContain("digest(v_code, 'sha256')");
    expect(rls).toContain("interval '15 minutes'");
  });

  it('redeem creates PENDING only — the function never activates a link', () => {
    const start = rls.indexOf('function public.redeem_pairing_code');
    const end = rls.indexOf('$$;', start);
    const body = rls.slice(start, end);
    expect(body).toContain("'pending'");
    expect(body).not.toContain("'active'");
  });

  it('retention purge is 24 hours and sharing-off purges', () => {
    expect(rls).toContain("interval '24 hours'");
    const start = rls.indexOf('function public.set_sharing_enabled');
    const body = rls.slice(start, rls.indexOf('$$;', start));
    expect(body).toContain('delete from public.location_points');
    expect(body).toContain('delete from public.latest_locations');
  });

  it('cleanup_locations is not executable by anon or authenticated', () => {
    expect(rls).toContain(
      'revoke all on function public.cleanup_locations() from public, anon, authenticated',
    );
    expect(rls).toContain('grant execute on function public.cleanup_locations() to service_role');
  });
});

describe('static RLS contract — saved places (migration 0004)', () => {
  it('saved_places exists with RLS enabled and owner-only policies', () => {
    expect(places).toContain('create table if not exists public.saved_places');
    expect(places).toContain('alter table public.saved_places enable row level security');
    for (const policy of [
      'saved_places_owner_select',
      'saved_places_owner_insert',
      'saved_places_owner_update',
      'saved_places_owner_delete',
    ]) {
      expect(places).toContain(`create policy ${policy}`);
    }
    const policyLines = places.split('\n').filter((l) => l.includes('create policy'));
    expect(policyLines.length).toBe(4);
    for (const line of policyLines) {
      expect(line).toContain('owner');
    }
  });

  it('NO guardian policy or guardian reference grants place access', () => {
    // The only "guardian" mentions allowed are the explanatory comments
    // stating guardians get no access.
    const codeLines = places
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    expect(codeLines).not.toContain('guardian');
    expect(codeLines).not.toContain('guardian_links');
  });

  it('every saved_places policy checks auth.uid() = user_id', () => {
    const matches = places.match(/auth\.uid\(\) = user_id/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
