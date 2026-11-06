/**
 * create-guardian-invite — HARDENED replacement core (NOT deployed).
 *
 * Difference from the deployed function: the invitation is BOUND to
 * the intended recipient's email address. The wearer must supply
 * `invited_email`; the accept function will only pair the account
 * whose VERIFIED email matches it. The code itself is stored only as
 * a SHA-256 hash, is single-use, and expires after 15 minutes.
 *
 * All logic lives here, runtime-agnostic, so the full flow is
 * testable under Deno with an in-memory store (see
 * supabase/tests/invites/core.deno.test.ts). index.ts only wires the
 * caller's identity and the real database store.
 *
 * Response contract (superset of the deployed one):
 * - 200 { invite_code, expires_at, invited_email, bound_to_email: true }
 * - 400 { error: "invalid_invited_email" }  (missing/malformed/self)
 * - 401 { error: "unauthorized" }
 * - 429 { error: "invite_rate_limited" }    (same code as deployed)
 */

export interface Caller {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
}

export interface InviteRow {
  wearer_user_id: string;
  invited_email: string;
  code_hash: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
}

export interface CreateInviteStore {
  countRecentByWearer(wearerId: string, sinceIso: string): Promise<number>;
  insertInvite(row: InviteRow): Promise<void>;
}

export interface InviteDeps {
  now: Date;
  randomBytes: (n: number) => Uint8Array;
  sha256Hex: (text: string) => Promise<string>;
}

export const INVITE_TTL_MS = 15 * 60 * 1000;
export const INVITE_RATE_LIMIT = 5; // per wearer per hour
export const INVITE_RATE_WINDOW_MS = 60 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 3 || e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

/** 16 random bytes → 32 uppercase hex chars, dashed 8×4 (deployed format). */
export function formatCode(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return hex.replace(/(.{4})(?=.)/g, '$1-');
}

export async function handleCreateInvite(
  store: CreateInviteStore,
  caller: Caller | null,
  body: unknown,
  deps: InviteDeps,
): Promise<{ status: number; json: Record<string, unknown> }> {
  if (!caller) return { status: 401, json: { error: 'unauthorized' } };
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, json: { error: 'invalid_invited_email' } };
  }
  const invited = normalizeEmail((body as { invited_email?: unknown }).invited_email);
  if (!invited) return { status: 400, json: { error: 'invalid_invited_email' } };
  const callerEmail = caller.email ? normalizeEmail(caller.email) : null;
  if (callerEmail && invited === callerEmail) {
    return { status: 400, json: { error: 'invalid_invited_email' } };
  }
  const since = new Date(deps.now.getTime() - INVITE_RATE_WINDOW_MS).toISOString();
  const recent = await store.countRecentByWearer(caller.id, since);
  if (recent >= INVITE_RATE_LIMIT) {
    return { status: 429, json: { error: 'invite_rate_limited' } };
  }
  const code = formatCode(deps.randomBytes(16));
  const row: InviteRow = {
    wearer_user_id: caller.id,
    invited_email: invited,
    code_hash: await deps.sha256Hex(code),
    created_at: deps.now.toISOString(),
    expires_at: new Date(deps.now.getTime() + INVITE_TTL_MS).toISOString(),
    used_at: null,
    used_by: null,
  };
  await store.insertInvite(row);
  return {
    status: 200,
    json: {
      invite_code: code,
      expires_at: row.expires_at,
      invited_email: invited,
      bound_to_email: true,
    },
  };
}
