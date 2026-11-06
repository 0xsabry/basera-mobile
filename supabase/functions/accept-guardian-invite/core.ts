/**
 * accept-guardian-invite — HARDENED replacement core (NOT deployed).
 *
 * Security contract (fixes the deployed bearer-code weakness):
 * - The caller must be authenticated with a VERIFIED email.
 * - The caller's verified email must exactly match the invitation's
 *   `invited_email` (case-insensitive). An unrelated account holding
 *   the code CANNOT pair.
 * - The code is looked up by its SHA-256 hash (plaintext codes are
 *   never stored), expires after 15 minutes, and is claimed
 *   ATOMICALLY (single-use even under concurrent requests).
 * - EVERY failure returns the same public error
 *   { error: "invalid_or_expired_invite" } — the deployed vocabulary —
 *   so the endpoint is not an oracle for which check failed. The
 *   internal `reason` is for server logs only and must never include
 *   the code or the invited email.
 *
 * All logic lives here, runtime-agnostic, testable under Deno with
 * an in-memory store (supabase/tests/invites/core.deno.test.ts).
 */

export interface Caller {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
}

export interface InviteRow {
  id: string;
  wearer_user_id: string;
  invited_email: string;
  code_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
}

export interface AcceptInviteStore {
  findByCodeHash(codeHash: string): Promise<InviteRow | null>;
  /** Atomically mark the invite used; resolves true only for the
   *  single winning caller (used_at was still null). */
  claimInvite(id: string, usedBy: string, usedAtIso: string): Promise<boolean>;
  findLink(wearerId: string, guardianId: string): Promise<{ id: string } | null>;
  insertLink(wearerId: string, guardianId: string): Promise<{ id: string }>;
}

export interface AcceptDeps {
  now: Date;
  sha256Hex: (text: string) => Promise<string>;
}

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (c.length < 8 || c.length > 64) return null;
  return c;
}

const fail = (reason: string) => ({
  status: 400,
  json: { error: 'invalid_or_expired_invite' },
  reason,
});

export async function handleAcceptInvite(
  store: AcceptInviteStore,
  caller: Caller | null,
  body: unknown,
  deps: AcceptDeps,
): Promise<{ status: number; json: Record<string, unknown>; reason?: string }> {
  if (!caller) {
    return { status: 401, json: { error: 'unauthorized' }, reason: 'no_caller' };
  }
  if (!caller.email || !caller.emailConfirmed) {
    return fail('caller_email_unverified');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('bad_body');
  }
  const code = normalizeCode((body as { invite_code?: unknown }).invite_code);
  if (!code) return fail('bad_code_shape');
  const row = await store.findByCodeHash(await deps.sha256Hex(code));
  if (!row) return fail('not_found');
  if (row.used_at) return fail('already_used');
  if (new Date(row.expires_at).getTime() <= deps.now.getTime()) {
    return fail('expired');
  }
  if (row.invited_email.trim().toLowerCase() !== caller.email.trim().toLowerCase()) {
    return fail('email_mismatch');
  }
  if (row.wearer_user_id === caller.id) return fail('self_pairing');
  const claimed = await store.claimInvite(row.id, caller.id, deps.now.toISOString());
  if (!claimed) return fail('lost_race');
  const existing = await store.findLink(row.wearer_user_id, caller.id);
  if (existing) {
    return { status: 200, json: { link_id: existing.id, status: 'paired' } };
  }
  const link = await store.insertLink(row.wearer_user_id, caller.id);
  return { status: 200, json: { link_id: link.id, status: 'paired' } };
}
