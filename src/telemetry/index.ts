/**
 * Telemetry singleton wiring (real dependencies).
 *
 * The endpoint is the `telemetry-ingest` Edge Function on the owner's
 * existing Supabase project; URL + publishable key resolve exactly like
 * the guardian client (env override, then app.json extra). The
 * installation secret travels only in the x-installation-secret header
 * and is stored server-side as a SHA-256 hash. No service-role key and
 * no user identity are involved — installations stay anonymous.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { updateService } from '../update/UpdateService';
import { readInstalledVersion } from '../update/appVersion';
import { Telemetry, type InstallationFacts, type KeyValueStore } from './telemetry';

const secureStoreAdapter: KeyValueStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
};

const asyncStorageAdapter: KeyValueStore = {
  get: (k) => AsyncStorage.getItem(k),
  set: (k, v) => AsyncStorage.setItem(k, v),
};

function resolveConfig(): { endpoint: string | null; publishableKey: string | null } {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? (extra.supabaseUrl as string | undefined);
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? (extra.supabaseAnonKey as string | undefined);
  if (!url || !key) return { endpoint: null, publishableKey: null };
  return { endpoint: `${url.replace(/\/$/, '')}/functions/v1/telemetry-ingest`, publishableKey: key };
}

function collectFacts(): InstallationFacts {
  let updates: {
    updateId: string | null;
    isEmbeddedLaunch: boolean;
    channel: string | null;
    runtimeVersion: string | null;
  } = { updateId: null, isEmbeddedLaunch: true, channel: null, runtimeVersion: null };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-updates') as typeof updates & { isEnabled?: boolean };
    if (mod && mod.isEnabled) updates = mod;
  } catch {
    /* updates unavailable (MVP / Expo Go) — facts stay embedded/null */
  }
  const installed = readInstalledVersion();
  return {
    platform: Platform.OS,
    os_version: String(Platform.Version ?? ''),
    app_version: installed.version,
    version_code: installed.build ? Number(installed.build) || null : null,
    runtime_version: updates.runtimeVersion,
    channel: updates.channel,
    current_update_id: updates.updateId,
    is_embedded_launch: updates.isEmbeddedLaunch,
  };
}

const { endpoint, publishableKey } = resolveConfig();

export const telemetry = new Telemetry({
  secureStore: secureStoreAdapter,
  fallbackStore: asyncStorageAdapter,
  endpoint,
  publishableKey,
  facts: collectFacts,
  now: () => new Date(),
  post: async (url, headers, body) => {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      return res.ok;
    } catch {
      return false;
    }
  },
});

let wired = false;

/**
 * App-start wiring: register the UpdateService sink FIRST so the
 * launch update flow's own events are captured, then initialize
 * (identity, applied-detection, registration/heartbeat flush).
 * Idempotent and fully failure-silent.
 */
export function initTelemetry(): void {
  if (wired) return;
  wired = true;
  updateService.setTelemetrySink((e) => telemetry.handleUpdateEvent(e));
  void telemetry.init();
}
