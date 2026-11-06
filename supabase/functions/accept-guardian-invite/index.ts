/**
 * accept-guardian-invite — HARDENED replacement (NOT deployed).
 *
 * Deployment requires the owner's explicit authorization plus the
 * additive migration 20261107000000_guardian_invites_hardening.sql
 * and the preflight in docs/INVITE_HARDENING_DEPLOY.md. Until then
 * the deployed bearer-code function remains in production.
 *
 * Wiring only: identity comes from the caller's JWT (verified by
 * Supabase, including the email_confirmed_at fact used by the core),
 * database access uses the service role. The claim is a single
 * conditional UPDATE (… WHERE used_at IS NULL), so concurrent
 * accepts cannot both succeed. Failure reasons are logged server-
 * side only; clients always see the combined public error.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  handleAcceptInvite,
  type AcceptInviteStore,
  type Caller,
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
  const store: AcceptInviteStore = {
    async findByCodeHash(codeHash) {
      const { data, error } = await service
        .schema('private')
        .from('guardian_invites')
        .select(
          'id, wearer_user_id, invited_email, code_hash, created_at, expires_at, used_at, used_by',
        )
        .eq('code_hash', codeHash)
        .maybeSingle();
      if (error) throw new Error('store_error');
      return (data as InviteRow | null) ?? null;
    },
    async claimInvite(id, usedBy, usedAtIso) {
      const { data, error } = await service
        .schema('private')
        .from('guardian_invites')
        .update({ used_at: usedAtIso, used_by: usedBy })
        .eq('id', id)
        .is('used_at', null)
        .select('id');
      if (error) throw new Error('store_error');
      return Array.isArray(data) && data.length === 1;
    },
    async findLink(wearerId, guardianId) {
      const { data, error } = await service
        .from('guardian_links')
        .select('id')
        .eq('subject_user_id', wearerId)
        .eq('guardian_user_id', guardianId)
        .maybeSingle();
      if (error) throw new Error('store_error');
      return data ? { id: data.id as string } : null;
    },
    async insertLink(wearerId, guardianId) {
      // Consent defaults come from the table (both flags FALSE).
      const { data, error } = await service
        .from('guardian_links')
        .insert({ subject_user_id: wearerId, guardian_user_id: guardianId })
        .select('id')
        .single();
      if (error) {
        // Lost a race with a parallel accept: return the winner's row.
        const again = await this.findLink(wearerId, guardianId);
        if (again) return again;
        throw new Error('store_error');
      }
      return { id: data.id as string };
    },
  };
  try {
    const result = await handleAcceptInvite(store, caller, body, {
      now: new Date(),
      sha256Hex,
    });
    if (result.reason) {
      // Server-side diagnostics only: never the code or the emails.
      console.log('accept_invite_failed', { reason: result.reason });
    }
    return Response.json(result.json, { status: result.status });
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
});
