/**
 * telemetry-ingest — BASERA installations & OTA adoption intake. (v5)
 *
 * DRAFT — not deployed. Deployment happens only after the owner's
 * final approval (see docs/TELEMETRY.md). Deploy with JWT verification
 * ON (config.toml: [functions.telemetry-ingest] verify_jwt = true):
 * the gateway then rejects requests carrying no valid JWT before this
 * code runs. The app sends the publishable key in the apikey header
 * only (the new Supabase keys are not JWTs) and NO user session —
 * telemetry works for logged-out users, and the
 * per-installation secret (checked in the database) is the real
 * credential. verify_jwt alone authenticates nothing (the key is
 * public); it is an anti-noise layer.
 *
 * This file is only wiring: all request handling lives in core.ts
 * (handleIngestRequest), which is fully tested under Deno with fake
 * RPCs. The database functions perform all writes: telemetry_ingest
 * in a single transaction (per-installation advisory lock,
 * pin-or-verify secret, strict per-event classification, atomic
 * hourly budget) and telemetry_bootstrap (server-CSPRNG identity
 * issuance under the global registration circuit breaker).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleIngestRequest } from './core.ts';

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  const call =
    (fn: string) =>
    async (args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      return { data, error };
    };
  return handleIngestRequest(req, {
    ingest: call('telemetry_ingest'),
    bootstrap: call('telemetry_bootstrap'),
  });
});
