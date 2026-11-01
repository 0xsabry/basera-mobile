/**
 * Supabase client for guardian features (V1.1).
 *
 * The owner's project is DEPLOYED (vbvvwyeccsegfwprwrga) and its URL +
 * publishable key ship as the app.json extra fallback; configuration can
 * be overridden by EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * (inlined by Expo at build time). The null-config path remains only as a
 * defensive fallback: if no config were present, getSupabaseClient()
 * returns null and guardian surfaces show the honest "not configured"
 * state — never fake data. See docs/SUPABASE_INTEGRATION.md.
 *
 * Only the publishable (client) key ever ships in the app — never any
 * service-role/secret key.
 *
 * Session storage: expo-secure-store, with chunking because a Supabase
 * session JSON can exceed SecureStore's per-value size limit.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export interface GuardianConfig {
  url: string;
  anonKey: string;
}

export function readGuardianConfig(
  env: Record<string, string | undefined> = process.env,
  extra: Record<string, unknown> = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>,
): GuardianConfig | null {
  const url = env.EXPO_PUBLIC_SUPABASE_URL ?? (extra.supabaseUrl as string | undefined);
  // The client key is a new-style publishable key; canonical names
  // first, legacy ANON names kept as fallbacks during the rename.
  const anonKey =
    env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    (extra.supabasePublishableKey as string | undefined) ??
    (extra.supabaseAnonKey as string | undefined);
  if (!url || !anonKey) return null;
  if (!/^https:\/\//.test(url)) return null;
  return { url, anonKey };
}

const CHUNK_SIZE = 1600;
const CHUNK_MARKER = 'chunked:';

async function clearChunks(key: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(`${key}__${i}`).catch(() => undefined);
  }
}

/** SecureStore-backed storage adapter for supabase-js auth sessions. */
export const secureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key);
    if (head === null) return null;
    if (!head.startsWith(CHUNK_MARKER)) return head;
    const count = Number.parseInt(head.slice(CHUNK_MARKER.length), 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    let out = '';
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}__${i}`);
      if (part === null) return null;
      out += part;
    }
    return out;
  },
  async setItem(key: string, value: string): Promise<void> {
    const previous = await SecureStore.getItemAsync(key);
    if (previous?.startsWith(CHUNK_MARKER)) {
      const oldCount = Number.parseInt(previous.slice(CHUNK_MARKER.length), 10);
      if (Number.isFinite(oldCount)) await clearChunks(key, oldCount);
    }
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const count = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${key}__${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(key, `${CHUNK_MARKER}${count}`);
  },
  async removeItem(key: string): Promise<void> {
    const previous = await SecureStore.getItemAsync(key);
    if (previous?.startsWith(CHUNK_MARKER)) {
      const count = Number.parseInt(previous.slice(CHUNK_MARKER.length), 10);
      if (Number.isFinite(count)) await clearChunks(key, count);
    }
    await SecureStore.deleteItemAsync(key);
  },
};

let cached: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const config = readGuardianConfig();
  if (!config) {
    cached = null;
    return null;
  }
  cached = createClient(config.url, config.anonKey, {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return cached;
}

/** Test helper. */
export function resetSupabaseClientCache(): void {
  cached = undefined;
}
