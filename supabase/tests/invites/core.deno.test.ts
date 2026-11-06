/**
 * Guardian invite hardening tests — run with Deno:
 *   deno test --allow-read supabase/tests/invites/core.deno.test.ts
 * Exercises the REAL cores of create-guardian-invite and
 * accept-guardian-invite against an in-memory store whose claim
 * operation mirrors the production conditional UPDATE
 * (… WHERE used_at IS NULL): the check-and-set is synchronous, so
 * concurrent accepts race exactly the way they do against Postgres.
 */
import {
  handleCreateInvite,
  type Caller as CreateCaller,
  type CreateInviteStore,
  type InviteRow as CreateRow,
} from '../../functions/create-guardian-invite/core.ts';
import {
  handleAcceptInvite,
  type AcceptInviteStore,
  type InviteRow as AcceptRow,
} from '../../functions/accept-guardian-invite/core.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEquals(a: unknown, b: unknown, msg: string) {
  if (a !== b)
    throw new Error(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

// Deterministic "random" bytes so tests are reproducible.
let seed = 7;
const detRandom = (n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = seed & 0xff;
  }
  return out;
};

const NOW = new Date('2026-11-07T10:00:00.000Z');
const WEARER: CreateCaller = {
  id: 'wearer-1',
  email: 'wearer@example.com',
  emailConfirmed: true,
};
const GUARDIAN = {
  id: 'guardian-1',
  email: 'guardian@example.com',
  emailConfirmed: true,
};
const STRANGER = {
  id: 'stranger-1',
  email: 'stranger@example.com',
  emailConfirmed: true,
};

class MemoryStore implements CreateInviteStore, AcceptInviteStore {
  invites: AcceptRow[] = [];
  links: { id: string; w: string; g: string }[] = [];
  private seq = 0;
  async countRecentByWearer(wearerId: string, sinceIso: string) {
    return this.invites.filter(
      (r) => r.wearer_user_id === wearerId && r.created_at >= sinceIso,
    ).length;
  }
  async insertInvite(row: CreateRow) {
    this.invites.push({ id: `inv-${++this.seq}`, ...row });
  }
  async findByCodeHash(codeHash: string) {
    const r = this.invites.find((x) => x.code_hash === codeHash);
    return r ? { ...r } : null; // copy, like a fresh DB read
  }
  async claimInvite(id: string, usedBy: string, usedAtIso: string) {
    // Synchronous check-and-set = the atomic conditional UPDATE.
    const r = this.invites.find((x) => x.id === id);
    if (!r || r.used_at) return false;
    r.used_at = usedAtIso;
    r.used_by = usedBy;
    return true;
  }
  async findLink(wearerId: string, guardianId: string) {
    const l = this.links.find((x) => x.w === wearerId && x.g === guardianId);
    return l ? { id: l.id } : null;
  }
  async insertLink(wearerId: string, guardianId: string) {
    const l = { id: `link-${++this.seq}`, w: wearerId, g: guardianId };
    this.links.push(l);
    return { id: l.id };
  }
}

async function createOk(store: MemoryStore, invited = 'guardian@example.com') {
  const res = await handleCreateInvite(
    store,
    WEARER,
    { invited_email: invited },
    { now: NOW, randomBytes: detRandom, sha256Hex },
  );
  assertEquals(res.status, 200, 'create status');
  return res.json as { invite_code: string; expires_at: string };
}

Deno.test('create: binds email, stores only the hash, 15-min expiry', async () => {
  const store = new MemoryStore();
  const { invite_code, expires_at } = await createOk(store);
  assert(/^[0-9A-F]{4}(-[0-9A-F]{4}){7}$/.test(invite_code), 'dashed hex format');
  assertEquals(
    expires_at,
    new Date(NOW.getTime() + 15 * 60 * 1000).toISOString(),
    'expiry = now + 15 min',
  );
  assertEquals(store.invites.length, 1, 'one invite stored');
  const row = store.invites[0];
  assertEquals(row.invited_email, 'guardian@example.com', 'bound email stored');
  assertEquals(row.code_hash, await sha256Hex(invite_code), 'only the hash is stored');
  assert(!JSON.stringify(row).includes(invite_code), 'plaintext code nowhere in the row');
});

Deno.test('create: rejects malformed and self invitations', async () => {
  const store = new MemoryStore();
  for (const bad of ['not-an-email', '', 'a@b', 42, null]) {
    const res = await handleCreateInvite(
      store,
      WEARER,
      { invited_email: bad },
      { now: NOW, randomBytes: detRandom, sha256Hex },
    );
    assertEquals(res.status, 400, `status for ${JSON.stringify(bad)}`);
    assertEquals(res.json.error, 'invalid_invited_email', 'error code');
  }
  const self = await handleCreateInvite(
    store,
    WEARER,
    { invited_email: 'Wearer@Example.com' },
    { now: NOW, randomBytes: detRandom, sha256Hex },
  );
  assertEquals(self.status, 400, 'self-invite rejected (case-insensitive)');
  assertEquals(store.invites.length, 0, 'nothing stored');
});

Deno.test('create: rate limit after 5 invites within the hour', async () => {
  const store = new MemoryStore();
  for (let i = 0; i < 5; i++) await createOk(store, `g${i}@example.com`);
  const res = await handleCreateInvite(
    store,
    WEARER,
    { invited_email: 'one-more@example.com' },
    { now: NOW, randomBytes: detRandom, sha256Hex },
  );
  assertEquals(res.status, 429, 'sixth create is rate-limited');
  assertEquals(res.json.error, 'invite_rate_limited', 'deployed error vocabulary');
});

Deno.test('accept: intended recipient pairs; link created; invite consumed', async () => {
  const store = new MemoryStore();
  const { invite_code } = await createOk(store);
  const res = await handleAcceptInvite(
    store,
    GUARDIAN,
    { invite_code },
    { now: NOW, sha256Hex },
  );
  assertEquals(res.status, 200, 'accept status');
  assertEquals(res.json.status, 'paired', 'paired');
  assertEquals(store.links.length, 1, 'one link');
  assert(store.invites[0].used_at !== null, 'invite marked used');
  assertEquals(store.invites[0].used_by, 'guardian-1', 'used_by recorded');
});

Deno.test('accept: UNRELATED account holding the code is rejected', async () => {
  const store = new MemoryStore();
  const { invite_code } = await createOk(store);
  const res = await handleAcceptInvite(
    store,
    STRANGER,
    { invite_code },
    { now: NOW, sha256Hex },
  );
  assertEquals(res.status, 400, 'stranger rejected');
  assertEquals(res.json.error, 'invalid_or_expired_invite', 'combined public error');
  assertEquals(res.reason, 'email_mismatch', 'internal reason logged');
  assertEquals(store.links.length, 0, 'no link created');
  assert(store.invites[0].used_at === null, 'invite NOT consumed by the failed attempt');
});

Deno.test('accept: unverified caller email cannot pair', async () => {
  const store = new MemoryStore();
  const { invite_code } = await createOk(store);
  const res = await handleAcceptInvite(
    store,
    { ...GUARDIAN, emailConfirmed: false },
    { invite_code },
    { now: NOW, sha256Hex },
  );
  assertEquals(res.status, 400, 'unverified rejected');
  assertEquals(res.reason, 'caller_email_unverified', 'reason');
  assertEquals(store.links.length, 0, 'no link');
});

Deno.test('accept: expired, reused and tampered codes all fail identically', async () => {
  const store = new MemoryStore();
  const { invite_code } = await createOk(store);
  const later = new Date(NOW.getTime() + 16 * 60 * 1000);
  const expired = await handleAcceptInvite(
    store,
    GUARDIAN,
    { invite_code },
    { now: later, sha256Hex },
  );
  assertEquals(expired.reason, 'expired', 'expired reason');
  const ok = await handleAcceptInvite(
    store,
    GUARDIAN,
    { invite_code },
    { now: NOW, sha256Hex },
  );
  assertEquals(ok.status, 200, 'first accept succeeds');
  const reused = await handleAcceptInvite(
    store,
    GUARDIAN,
    { invite_code },
    { now: NOW, sha256Hex },
  );
  assertEquals(reused.status, 400, 'reuse rejected');
  assertEquals(reused.reason, 'already_used', 'reuse reason');
  const tampered = await handleAcceptInvite(
    store,
    GUARDIAN,
    { invite_code: 'FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF-FFFF' },
    { now: NOW, sha256Hex },
  );
  assertEquals(tampered.status, 400, 'tampered rejected');
  for (const r of [expired, reused, tampered]) {
    assertEquals(
      r.json.error,
      'invalid_or_expired_invite',
      'public error is identical for every failure (no oracle)',
    );
  }
});

Deno.test('accept: concurrent duplicate accepts — exactly one wins', async () => {
  const store = new MemoryStore();
  const { invite_code } = await createOk(store);
  const [a, b] = await Promise.all([
    handleAcceptInvite(store, GUARDIAN, { invite_code }, { now: NOW, sha256Hex }),
    handleAcceptInvite(store, GUARDIAN, { invite_code }, { now: NOW, sha256Hex }),
  ]);
  const wins = [a, b].filter((r) => r.status === 200).length;
  assertEquals(wins, 1, 'exactly one concurrent accept succeeds');
  assertEquals(store.links.length, 1, 'exactly one link created');
});

Deno.test('accept: second invite for an already-paired pair returns the same link', async () => {
  const store = new MemoryStore();
  const first = await createOk(store);
  const r1 = await handleAcceptInvite(
    store,
    GUARDIAN,
    { invite_code: first.invite_code },
    { now: NOW, sha256Hex },
  );
  const second = await createOk(store);
  const r2 = await handleAcceptInvite(
    store,
    GUARDIAN,
    { invite_code: second.invite_code },
    { now: NOW, sha256Hex },
  );
  assertEquals(r2.status, 200, 'second accept ok');
  assertEquals(r2.json.link_id, r1.json.link_id, 'same link returned');
  assertEquals(store.links.length, 1, 'no duplicate link');
});

Deno.test('accept: email match is case-insensitive; self-pairing impossible', async () => {
  const store = new MemoryStore();
  const { invite_code } = await createOk(store, 'Guardian@Example.com');
  const res = await handleAcceptInvite(
    store,
    GUARDIAN,
    { invite_code },
    { now: NOW, sha256Hex },
  );
  assertEquals(res.status, 200, 'case-insensitive match pairs');
  const store2 = new MemoryStore();
  const c2 = await createOk(store2, 'someone@example.com');
  const selfRes = await handleAcceptInvite(
    store2,
    { id: 'wearer-1', email: 'someone@example.com', emailConfirmed: true },
    { invite_code: c2.invite_code },
    { now: NOW, sha256Hex },
  );
  // The wearer cannot pair with themselves even via a third-party email:
  // invited_email belongs to an account whose id equals the wearer's.
  assertEquals(selfRes.status, 400, 'self-pairing rejected');
  assertEquals(selfRes.reason, 'self_pairing', 'reason');
});
