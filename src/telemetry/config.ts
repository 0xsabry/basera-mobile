/**
 * Supabase configuration resolution for telemetry.
 *
 * The project's client key is a NEW-style Supabase **publishable**
 * key (sb_publishable_...). The canonical variable names say so:
 *   env:   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   extra: supabasePublishableKey
 * The legacy names (EXPO_PUBLIC_SUPABASE_ANON_KEY / supabaseAnonKey)
 * are still honored as fallbacks so older local .env files and EAS
 * environments keep working during the rename. The key value is
 * public by design; it is still never logged anywhere.
 */
export interface ResolvedSupabaseConfig {
  url: string | null;
  publishableKey: string | null;
  endpoint: string | null;
}

export function resolveSupabaseConfig(
  env: Record<string, string | undefined>,
  extra: Record<string, unknown>,
): ResolvedSupabaseConfig {
  const url =
    env.EXPO_PUBLIC_SUPABASE_URL ?? (extra.supabaseUrl as string | undefined) ?? null;
  const publishableKey =
    env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    (extra.supabasePublishableKey as string | undefined) ??
    (extra.supabaseAnonKey as string | undefined) ??
    null;
  if (!url || !publishableKey) return { url, publishableKey, endpoint: null };
  return {
    url,
    publishableKey,
    endpoint: `${url.replace(/\/$/, '')}/functions/v1/telemetry-ingest`,
  };
}
