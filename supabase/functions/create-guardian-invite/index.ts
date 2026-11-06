/**
 * create-guardian-invite — HARDENED replacement (NOT deployed).
 *
 * Deployment requires the owner's explicit authorization plus the
 * additive migration 20261107000000_guardian_invites_hardening.sql
 * and the preflight in docs/INVITE_HARDENING_DEPLOY.md. Until then
 * the deployed bearer-code function remains in production.
 *
 * Wiring only: identity comes from the caller's JWT (verified by
 * Supabase), database access uses the service role against
 * private.guardian_invites (RLS on, no client policies — the table
 * is reachable only from Edge Functions).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  handleCreateInvite,
  type Caller,
  type CreateInviteStore,
  type InviteRow,
} from './core.ts';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const service = createClient(url, serviceKey);
  const { data: userData, error: userError } = await service.auth.getUser(token);
  if (userError || !userData.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const caller: Caller = {
    id: userData.user.id,
    email: userData.user.email ?? null,
    emailConfirmed: !!userData.user.email_confirmed_at,
  };
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const store: CreateInviteStore = {
    async countRecentByWearer(wearerId, sinceIso) {
      const { count, error } = await service
        .schema('private')
        .from('guardian_invites')
        .select('id', { count: 'exact', head: true })
        .eq('wearer_user_id', wearerId)
        .gte('created_at', sinceIso);
      if (error) throw new Error('store_error');
      return count ?? 0;
    },
    async insertInvite(row: InviteRow) {
      const { error } = await service
        .schema('private')
        .from('guardian_invites')
        .insert(row);
      if (error) throw new Error('store_error');
    },
  };
  try {
    const result = await handleCreateInvite(store, caller, body, {
      now: new Date(),
      randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
      sha256Hex,
    });
    return Response.json(result.json, { status: result.status });
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
