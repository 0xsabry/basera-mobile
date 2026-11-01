/**
 * Supabase configuration alignment tests.
 *
 * The project's client key is a new-style PUBLISHABLE key. The
 * canonical variable names must say so, the legacy ANON names remain
 * working fallbacks, and the telemetry endpoint must be derivable
 * from the shipped configuration. (Key values are dummies here and
 * are never logged.)
 */
import { resolveSupabaseConfig } from '../config';

const URL = 'https://project-ref.supabase.co';
const KEY = 'sb_publishable_dummy';

describe('resolveSupabaseConfig', () => {
  it('prefers the canonical PUBLISHABLE env name over the legacy ANON name', () => {
    const cfg = resolveSupabaseConfig(
      {
        EXPO_PUBLIC_SUPABASE_URL: URL,
        EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'legacy-value',
      },
      {},
    );
    expect(cfg.publishableKey).toBe(KEY);
    expect(cfg.endpoint).toBe(`${URL}/functions/v1/telemetry-ingest`);
  });

  it('falls back to the legacy ANON env name when the canonical one is absent', () => {
    const cfg = resolveSupabaseConfig(
      { EXPO_PUBLIC_SUPABASE_URL: URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: KEY },
      {},
    );
    expect(cfg.publishableKey).toBe(KEY);
    expect(cfg.endpoint).toBe(`${URL}/functions/v1/telemetry-ingest`);
  });

  it('reads the canonical extra key first, then the legacy extra key', () => {
    expect(
      resolveSupabaseConfig({}, { supabaseUrl: URL, supabasePublishableKey: KEY }).publishableKey,
    ).toBe(KEY);
    expect(
      resolveSupabaseConfig({}, { supabaseUrl: URL, supabaseAnonKey: KEY }).publishableKey,
    ).toBe(KEY);
  });

  it('builds the endpoint without a double slash and returns null endpoint when unconfigured', () => {
    expect(
      resolveSupabaseConfig(
        { EXPO_PUBLIC_SUPABASE_URL: `${URL}/`, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: KEY },
        {},
      ).endpoint,
    ).toBe(`${URL}/functions/v1/telemetry-ingest`);
    expect(resolveSupabaseConfig({}, {}).endpoint).toBeNull();
    expect(resolveSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: URL }, {}).endpoint).toBeNull();
  });
});
