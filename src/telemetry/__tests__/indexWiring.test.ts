/**
 * Real-path wiring tests for src/telemetry/index.ts.
 *
 * The config unit tests cover config.ts in isolation; THIS suite
 * imports the actual index module (with the native edges mocked) and
 * proves the singleton is built from the canonical publishable-key
 * configuration and that facts() reports an UNKNOWN embedded state
 * (null) when expo-updates cannot be loaded — never a fabricated
 * true.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        supabaseUrl: 'https://proj.example.co',
        // ONLY the canonical key is present — no legacy fallback
        // exists in this configuration, so resolution can only
        // succeed through the canonical name.
        supabasePublishableKey: 'sb_publishable_CANON',
      },
    },
  },
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));

// expo-updates present but DISABLED (the Expo Go / dev-client case):
// collectFacts must keep its unknown fallback (null), never a
// fabricated embedded=true.
jest.mock('expo-updates', () => ({
  isEnabled: false,
  updateId: null,
  isEmbeddedLaunch: true, // even a readable true must be ignored while disabled
  channel: null,
  runtimeVersion: null,
}));

jest.mock('../../update/UpdateService', () => ({
  updateService: { setTelemetrySink: () => undefined },
}));

jest.mock('../../update/appVersion', () => ({
  readInstalledVersion: () => ({ version: '1.1.8', build: '10' }),
}));

describe('telemetry index wiring (real module)', () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  });
  afterAll(() => {
    process.env = savedEnv;
  });

  it('builds the singleton endpoint from resolveSupabaseConfig via the canonical publishable key', () => {
    // The EAS/env path: canonical env names feed the real resolver
    // inside the real index module at import time. (The app.json
    // extra path of the same resolver is unit-proven in
    // config.test.ts; the shared expo mock intentionally carries no
    // expoConfig, so env is the honest route here.)
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://proj.example.co';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_CANON';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { telemetry } = require('../index') as typeof import('../index');
    const deps = (telemetry as unknown as { deps: Record<string, unknown> }).deps;
    expect(deps.endpoint).toBe('https://proj.example.co/functions/v1/telemetry-ingest');
    expect(deps.publishableKey).toBe('sb_publishable_CANON');
  });

  it('facts() reports is_embedded_launch as null (unknown) when expo-updates cannot load', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { telemetry } = require('../index') as typeof import('../index');
    const deps = (telemetry as unknown as { deps: { facts: () => import('../telemetry').InstallationFacts } }).deps;
    const facts = deps.facts();
    expect(facts.is_embedded_launch).toBeNull();
    expect(facts.current_update_id).toBeNull();
    expect(facts.platform).toBe('android');
    expect(facts.app_version).toBe('1.1.8');
  });

  it('index.ts contains no legacy resolver and no fabricated embedded default (source guard)', () => {
    const src = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    expect(src).toContain("from './config'");
    expect(src).toContain('resolveSupabaseConfig');
    expect(src).not.toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    expect(src).not.toContain('supabaseAnonKey');
    expect(src).not.toContain('isEmbeddedLaunch: true');
  });
});
