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
import { resolveSupabaseConfig } from './config';
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
  const { endpoint, publishableKey } = resolveSupabaseConfig(process.env, extra);
  return { endpoint, publishableKey };
}

function collectFacts(): InstallationFacts {
  let updates: {
    updateId: string | null;
    isEmbeddedLaunch: boolean | null;
    channel: string | null;
    runtimeVersion: string | null;
    // Unknown until the real module proves otherwise: an unreadable
    // embedded state is null (unknown), NEVER a fabricated true.
  } = { updateId: null, isEmbeddedLaunch: null, channel: null, runtimeVersion: null };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-updates') as {
      updateId: string | null;
      isEmbeddedLaunch?: unknown;
      channel: string | null;
      runtimeVersion: string | null;
      isEnabled?: boolean;
    };
    if (mod && mod.isEnabled) {
      updates = {
        updateId: mod.updateId,
        isEmbeddedLaunch: typeof mod.isEmbeddedLaunch === 'boolean' ? mod.isEmbeddedLaunch : null,
        channel: mod.channel,
        runtimeVersion: mod.runtimeVersion,
      };
    }
  } catch {
    /* updates unavailable (MVP / Expo Go) — facts stay embedded/null */
  }
  const installed = readInstalledVersion();
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
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
  // The envelope (queue/pool/state) holds no secrets: plain storage.
  // The identity lives in SecureStore ONLY (see telemetry.ts).
  queueStore: asyncStorageAdapter,
  secureStore: secureStoreAdapter,
  endpoint,
  publishableKey,
  facts: collectFacts,
  now: () => new Date(),
  post: async (url, headers, body) => {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) return null; // batch-level failure: keep the whole queue
      const data = (await res.json()) as {
        accepted?: string[];
        duplicates?: string[];
        rejected?: { client_event_id: string | null; reason: string }[];
        event_id_pool?: string[];
      };
      return {
        accepted: data.accepted ?? [],
        duplicates: data.duplicates ?? [],
        rejected: data.rejected ?? [],
        event_id_pool: data.event_id_pool ?? [],
      };
    } catch {
      return null;
    }
  },
  requestBootstrap: async (facts) => {
    if (!endpoint || !publishableKey) return null;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Publishable key in the apikey header only (not a JWT).
          apikey: publishableKey,
          'x-telemetry-bootstrap': '1',
        },
        body: JSON.stringify({ installation: facts }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        installation_id?: string;
        installation_secret?: string;
        event_id_pool?: string[];
      };
      if (!data.installation_id || !data.installation_secret) return null;
      return {
        installation_id: data.installation_id,
        installation_secret: data.installation_secret,
        event_id_pool: data.event_id_pool ?? [],
      };
    } catch {
      return null;
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
