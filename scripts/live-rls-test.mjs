#!/usr/bin/env node
/**
 * BASERA × Supabase — LIVE integration / RLS test harness.
 *
 * Runs the owner's acceptance matrix against the DEPLOYED project
 * (vbvvwyeccsegfwprwrga) with three real, owner-confirmed accounts.
 * Nothing here is mocked: every PASS/FAIL is a real server response.
 *
 * Usage:
 *   node scripts/live-rls-test.mjs
 * Credentials (never committed):
 *   ~/workspace/.scratch-basera/supabase-live/test-accounts.json (0600)
 *   { wearer: {email, password}, guardian: {...}, stranger: {...} }
 *
 * Exit code: 0 when every gated case passes; 1 otherwise. Cases marked
 * OBSERVED report real behavior without gating (they document where
 * the deployed contract differs from the original design brief);
 * NOT TESTABLE cases say exactly why.
 *
 * The harness cleans up the links/locations/token rows it creates.
 * sos_alerts rows CANNOT be deleted by clients (verified: no delete
 * policy — append-only safety log), so harness alerts carry a sentinel
 * latitude (29.987654) and remain visible in the test wearer's history.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SUPABASE_URL = 'https://vbvvwyeccsegfwprwrga.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_Jt84WL6Ra7Ww_XV34Bk8eA_NwDYSecI';
const ACCOUNTS_PATH =
  process.env.BASERA_TEST_ACCOUNTS ??
  join(homedir(), 'workspace/.scratch-basera/supabase-live/test-accounts.json');

const SENTINEL = { lat: 29.987654, lng: 31.123456 };
const FIX = { lat: 30.111111, lng: 31.222222, accuracy: 10 };
const FIX2 = { lat: 30.333333, lng: 31.444444, accuracy: 8 };

let accounts;
try {
  accounts = JSON.parse(readFileSync(ACCOUNTS_PATH, 'utf8'));
} catch (e) {
  console.error(`BLOCKED: cannot read test accounts at ${ACCOUNTS_PATH}: ${e.message}`);
  console.error(
    'The owner must create the wearer/guardian/stranger users (Dashboard → Auth → Users, Auto-Confirm) and store their credentials in that file.',
  );
  process.exit(2);
}
for (const role of ['wearer', 'guardian', 'stranger']) {
  if (!accounts[role]?.email || !accounts[role]?.password || String(accounts[role].id ?? '').startsWith('NO-ID')) {
    console.error(`BLOCKED: test account "${role}" is missing or unconfirmed in ${ACCOUNTS_PATH}`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- framework
const results = [];
function record(kind, name, ok, detail = '') {
  results.push({ kind, name, ok, detail });
  const tag = kind === 'OBSERVED' ? 'OBSERVED' : kind === 'NOT TESTABLE' ? 'NOT TESTABLE' : ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    record('CASE', name, true, typeof detail === 'string' ? detail : '');
  } catch (e) {
    record('CASE', name, false, e instanceof Error ? e.message : String(e));
  }
}
function expect(cond, message) {
  if (!cond) throw new Error(message);
}
async function observed(name, fn) {
  try {
    const detail = await fn();
    record('OBSERVED', name, true, typeof detail === 'string' ? detail : '');
  } catch (e) {
    record('OBSERVED', name, false, e instanceof Error ? e.message : String(e));
  }
}

// ---------------------------------------------------------------- clients
async function login(role) {
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: accounts[role].email,
    password: accounts[role].password,
  });
  if (error) throw new Error(`${role} login failed: ${error.message}`);
  return { client, id: data.user.id, email: data.user.email };
}

const wearer = await login('wearer');
const guardian = await login('guardian');
const stranger = await login('stranger');
console.log(`Live harness against ${SUPABASE_URL}`);
console.log(`wearer=${wearer.id} guardian=${guardian.id} stranger=${stranger.id}\n`);

const rows = async (client, table, build) => {
  let q = client.from(table).select('*');
  if (build) q = build(q);
  const { data, error } = await q;
  if (error) throw new Error(`${table} select: ${error.message}`);
  return data ?? [];
};
const invokeError = async (client, fn, body) => {
  const { data, error } = await client.functions.invoke(fn, { body });
  if (!error) return { data, serverCode: null };
  let serverCode = null;
  try {
    const parsed = await error.context.json();
    serverCode = parsed?.error ?? null;
  } catch {
    /* no body */
  }
  return { data: null, serverCode, message: error.message };
};

// ---------------------------------------------------------------- cleanup (start)
async function cleanupLinksAndLocations() {
  for (const who of [wearer, guardian]) {
    const links = await rows(who.client, 'guardian_links');
    for (const link of links) {
      await who.client.from('guardian_links').delete().eq('id', link.id);
    }
  }
  await wearer.client.from('guardian_locations').delete().eq('subject_user_id', wearer.id);
  await wearer.client.from('user_push_tokens').delete().eq('user_id', wearer.id);
}
await cleanupLinksAndLocations();

// ---------------------------------------------------------------- discovery printout
console.log('--- Deployed schema (from live rows) ---');
{
  const profile = await wearer.client
    .from('profiles')
    .upsert({ id: wearer.id }, { onConflict: 'id', ignoreDuplicates: true });
  if (profile.error) console.log(`profiles ensure: ERROR ${profile.error.message}`);
  const [p] = await rows(wearer.client, 'profiles', (q) => q.eq('id', wearer.id));
  console.log(`profiles columns: ${p ? Object.keys(p).sort().join(', ') : '(none)'}`);
}
console.log('-----------------------------------------\n');

// ---------------------------------------------------------------- matrix
let inviteCode = null;
let inviteExpiresAt = null;
let linkId = null;

await check('pre-pairing: stranger cannot read the wearer profile', async () => {
  const found = await rows(stranger.client, 'profiles', (q) => q.eq('id', wearer.id));
  expect(found.length === 0, `stranger saw ${found.length} profile rows`);
});
await check('pre-pairing: guardian (not yet linked) cannot read the wearer profile', async () => {
  const found = await rows(guardian.client, 'profiles', (q) => q.eq('id', wearer.id));
  expect(found.length === 0, `guardian saw ${found.length} profile rows before pairing`);
});
await check('pre-pairing: nobody but the wearer can read wearer locations or links', async () => {
  for (const who of [guardian, stranger]) {
    const locs = await rows(who.client, 'guardian_locations', (q) => q.eq('subject_user_id', wearer.id));
    expect(locs.length === 0, 'location rows visible pre-pairing');
    const links = await rows(who.client, 'guardian_links');
    expect(links.length === 0, 'link rows visible to an unrelated user');
  }
});
await check('ensure-profile is idempotent for all three accounts', async () => {
  for (const who of [wearer, guardian, stranger]) {
    const { error } = await who.client
      .from('profiles')
      .upsert({ id: who.id }, { onConflict: 'id', ignoreDuplicates: true });
    expect(!error, `upsert failed: ${error?.message}`);
    const mine = await rows(who.client, 'profiles', (q) => q.eq('id', who.id));
    expect(mine.length === 1, 'own profile row missing after ensure');
  }
});

// The deployed create function rate-limits per wearer
// ({"error":"invite_rate_limited"}, verified live): retry with
// bounded backoff instead of failing the whole run.
async function createInviteWithRetry(client, attempts = 16) {
  let lastCode = null;
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await client.functions.invoke('create-guardian-invite', { body: {} });
    if (!error && data?.invite_code) return data;
    if (error) {
      try {
        lastCode = (await error.context.json())?.error ?? null;
      } catch {
        lastCode = null;
      }
    }
    if (lastCode !== 'invite_rate_limited') {
      throw new Error(`create invite failed (${lastCode ?? error?.message ?? 'no code'})`);
    }
    if (i < attempts - 1) {
      console.log('  … invite_rate_limited — waiting 30s (bounded retry)');
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  throw new Error('create invite still rate-limited after bounded retries');
}

await check('wearer creates an invite (code + expiry returned)', async () => {
  const data = await createInviteWithRetry(wearer.client);
  expect(typeof data?.invite_code === 'string' && data.invite_code.length >= 8, 'no invite_code in payload');
  expect(typeof data?.expires_at === 'string', 'no expires_at in payload');
  inviteCode = data.invite_code;
  inviteExpiresAt = data.expires_at;
  const ttlMin = (Date.parse(inviteExpiresAt) - Date.now()) / 60000;
  expect(ttlMin > 0 && ttlMin <= 20, `unexpected ttl ${ttlMin.toFixed(1)} min`);
  return `code format ${inviteCode.split('-').length} dashed groups, ttl ≈ ${ttlMin.toFixed(1)} min`;
});

await check('stranger accept with a WRONG code is rejected', async () => {
  const res = await invokeError(stranger.client, 'accept-guardian-invite', { invite_code: 'DEAD-BEEF-DEAD-BEEF' });
  expect(res.serverCode === 'invalid_or_expired_invite', `expected invalid_or_expired_invite, got ${res.serverCode ?? res.message}`);
});
await check('wearer SELF-accept of the real code is rejected', async () => {
  const res = await invokeError(wearer.client, 'accept-guardian-invite', { invite_code: inviteCode });
  expect(res.serverCode === 'invalid_or_expired_invite', `expected invalid_or_expired_invite, got ${res.serverCode ?? res.message}`);
});
await check('guardian accepts the invite → link paired, BOTH consent flags FALSE', async () => {
  const { data, error } = await guardian.client.functions.invoke('accept-guardian-invite', {
    body: { invite_code: inviteCode },
  });
  if (error) {
    let code = '';
    try {
      code = (await error.context.json())?.error ?? '';
    } catch { /* ignore */ }
    throw new Error(`accept failed: ${error.message} (server: ${code || 'n/a'})`);
  }
  expect(data?.status === 'paired', `unexpected status ${data?.status}`);
  linkId = data.link_id;
  expect(typeof linkId === 'string', 'no link_id returned');
  const links = await rows(wearer.client, 'guardian_links', (q) => q.eq('id', linkId));
  expect(links.length === 1, 'wearer cannot see the new link');
  expect(links[0].location_sharing_enabled === false, 'location consent not FALSE at pairing');
  expect(links[0].sos_sharing_enabled === false, 'sos consent not FALSE at pairing');
});
await check('after pairing, the guardian CAN read the wearer profile (deployed behavior)', async () => {
  const found = await rows(guardian.client, 'profiles', (q) => q.eq('id', wearer.id));
  expect(found.length === 1, 'linked guardian cannot read wearer profile');
});

await check('location stays invisible to the guardian BEFORE location consent (row exists)', async () => {
  const { error } = await wearer.client.from('guardian_locations').upsert(
    { subject_user_id: wearer.id, latitude: FIX.lat, longitude: FIX.lng, accuracy_m: FIX.accuracy },
    { onConflict: 'subject_user_id' },
  );
  expect(!error, `wearer upsert failed: ${error?.message}`);
  const seen = await rows(guardian.client, 'guardian_locations', (q) => q.eq('subject_user_id', wearer.id));
  expect(seen.length === 0, 'guardian saw the location before consent');
  const strangerSeen = await rows(stranger.client, 'guardian_locations', (q) => q.eq('subject_user_id', wearer.id));
  expect(strangerSeen.length === 0, 'stranger saw the location');
});
await check('guardian CANNOT change consent (wearer-only)', async () => {
  const { data } = await guardian.client
    .from('guardian_links')
    .update({ location_sharing_enabled: true })
    .eq('id', linkId)
    .select('*');
  expect(!data || data.length === 0, 'guardian update affected rows');
  const [link] = await rows(wearer.client, 'guardian_links', (q) => q.eq('id', linkId));
  expect(link.location_sharing_enabled === false, 'consent flag changed by the guardian');
});
await check('wearer enables location consent → guardian CAN read the latest location; stranger still cannot', async () => {
  const { data, error } = await wearer.client
    .from('guardian_links')
    .update({ location_sharing_enabled: true })
    .eq('id', linkId)
    .select('*');
  expect(!error && data?.length === 1, `consent update failed: ${error?.message}`);
  const seen = await rows(guardian.client, 'guardian_locations', (q) => q.eq('subject_user_id', wearer.id));
  expect(seen.length === 1, 'guardian cannot read the location after consent');
  expect(Math.abs(seen[0].latitude - FIX.lat) < 1e-9, 'latitude mismatch');
  const strangerSeen = await rows(stranger.client, 'guardian_locations', (q) => q.eq('subject_user_id', wearer.id));
  expect(strangerSeen.length === 0, 'stranger saw the location after consent');
});

let sosId = null;
await check('SOS is invisible to the guardian BEFORE sos consent (separate flag)', async () => {
  const { data, error } = await wearer.client
    .from('sos_alerts')
    .insert({ subject_user_id: wearer.id, latitude: SENTINEL.lat, longitude: SENTINEL.lng })
    .select('*');
  expect(!error, `sos insert failed: ${error?.message}`);
  sosId = data[0].id;
  const seen = await rows(guardian.client, 'sos_alerts', (q) => q.eq('id', sosId));
  expect(seen.length === 0, 'guardian saw the SOS before sos consent');
});
await check('wearer enables SOS consent → guardian CAN read the SOS; stranger cannot', async () => {
  await wearer.client.from('guardian_links').update({ sos_sharing_enabled: true }).eq('id', linkId);
  const seen = await rows(guardian.client, 'sos_alerts', (q) => q.eq('id', sosId));
  expect(seen.length === 1, 'guardian cannot read the SOS after sos consent');
  expect(seen[0].status === 'active', `unexpected sos status ${seen[0].status}`);
  const strangerSeen = await rows(stranger.client, 'sos_alerts', (q) => q.eq('id', sosId));
  expect(strangerSeen.length === 0, 'stranger saw the SOS');
});
await check('guardian CANNOT resolve the SOS (wearer-only updates)', async () => {
  const { data } = await guardian.client
    .from('sos_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', sosId)
    .select('*');
  expect(!data || data.length === 0, 'guardian resolved the alert');
});
await check('wearer resolves their own SOS', async () => {
  const { data, error } = await wearer.client
    .from('sos_alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', sosId)
    .select('*');
  expect(!error && data?.length === 1 && data[0].status === 'resolved', 'wearer resolve failed');
});

// Realtime smoke — reported as its own case.
await check('REALTIME: guardian receives the wearer location upsert + SOS insert live', async () => {
  const events = [];
  const channel = guardian.client
    .channel('live-rls-harness')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'guardian_locations', filter: `subject_user_id=eq.${wearer.id}` },
      (p) => events.push(`location:${p.eventType}`),
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'sos_alerts', filter: `subject_user_id=eq.${wearer.id}` },
      () => events.push('sos:INSERT'),
    )
    .subscribe();
  await new Promise((r) => setTimeout(r, 4000));
  await wearer.client.from('guardian_locations').upsert(
    { subject_user_id: wearer.id, latitude: FIX2.lat, longitude: FIX2.lng, accuracy_m: FIX2.accuracy },
    { onConflict: 'subject_user_id' },
  );
  await wearer.client
    .from('sos_alerts')
    .insert({ subject_user_id: wearer.id, latitude: SENTINEL.lat, longitude: SENTINEL.lng });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (events.some((e) => e.startsWith('location:')) && events.includes('sos:INSERT')) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await guardian.client.removeChannel(channel);
  expect(events.some((e) => e.startsWith('location:')), `no location event (got: ${events.join(', ') || 'none'})`);
  expect(events.includes('sos:INSERT'), `no sos event (got: ${events.join(', ') || 'none'})`);
  return `events: ${events.join(', ')}`;
});

// Runs while the GUARDIAN link is active: settles whether a wearer
// may hold more than one link. (Harness run 1 paired the stranger
// first and the guardian accept then failed without a captured
// server code; the final run proved multi-link pairing works, so
// that failure was invite-limiter-era fallout, not a one-link rule.)
await observed('stranger accept with the REAL code while a guardian link is active (bearer-code probe)', async () => {
  const inv = await createInviteWithRetry(wearer.client, 6);
  const res = await invokeError(stranger.client, 'accept-guardian-invite', { invite_code: inv.invite_code });
  if (res.serverCode) {
    return `REJECTED by the function (${res.serverCode}) while a guardian link was active — pairing is NOT pure bearer-code, or a one-active-link rule applies`;
  }
  const strangerLinks = await rows(stranger.client, 'guardian_links');
  for (const link of strangerLinks) {
    await stranger.client.from('guardian_links').delete().eq('id', link.id);
  }
  return 'ACCEPTED alongside the active guardian link — the invite code is a bearer capability: ANY signed-in user holding it pairs (probe link cleaned up). Mitigation in the deployed design: every new link starts with BOTH consent flags FALSE, so a wrongly-paired account sees nothing until the wearer enables consent for that link.';
});

await check('invite REUSE is rejected', async () => {
  const res = await invokeError(guardian.client, 'accept-guardian-invite', { invite_code: inviteCode });
  expect(res.serverCode === 'invalid_or_expired_invite', `expected invalid_or_expired_invite, got ${res.serverCode ?? res.message}`);
});
record(
  'NOT TESTABLE',
  'expired invite is rejected',
  true,
  'the function offers no expiry control and codes live ~15 min (expires_at verified at creation); waiting out a real expiry is out of scope for this harness — the same invalid_or_expired_invite code covers expiry by design',
);

await check('wearer disables location consent → guardian loses location access immediately', async () => {
  await wearer.client.from('guardian_links').update({ location_sharing_enabled: false }).eq('id', linkId);
  const seen = await rows(guardian.client, 'guardian_locations', (q) => q.eq('subject_user_id', wearer.id));
  expect(seen.length === 0, 'guardian still sees the location after consent off');
});
await check('wearer deletes their latest-location row → gone for everyone', async () => {
  await wearer.client.from('guardian_locations').delete().eq('subject_user_id', wearer.id);
  const mine = await rows(wearer.client, 'guardian_locations', (q) => q.eq('subject_user_id', wearer.id));
  expect(mine.length === 0, 'location row still exists after wearer delete');
});

await check('push token registers for the wearer only (expo_push_token / android)', async () => {
  const { error } = await wearer.client.from('user_push_tokens').insert({
    user_id: wearer.id,
    platform: 'android',
    expo_push_token: 'ExponentPushToken[harness]',
  });
  expect(!error, `token insert failed: ${error?.message}`);
  const mine = await rows(wearer.client, 'user_push_tokens', (q) => q.eq('user_id', wearer.id));
  expect(mine.length === 1, 'wearer cannot read own token row');
  for (const who of [guardian, stranger]) {
    const seen = await rows(who.client, 'user_push_tokens', (q) => q.eq('user_id', wearer.id));
    expect(seen.length === 0, 'another user read the token row');
  }
  await wearer.client.from('user_push_tokens').delete().eq('user_id', wearer.id);
});

await check('UNLINK (guardian deletes the link) → all link-scoped access ends', async () => {
  // Re-enable consent first so the access loss is attributable to the unlink.
  await wearer.client.from('guardian_links').update({ location_sharing_enabled: true }).eq('id', linkId);
  await wearer.client.from('guardian_locations').upsert(
    { subject_user_id: wearer.id, latitude: FIX.lat, longitude: FIX.lng },
    { onConflict: 'subject_user_id' },
  );
  const before = await rows(guardian.client, 'guardian_locations', (q) => q.eq('subject_user_id', wearer.id));
  expect(before.length === 1, 'setup failed: guardian should see the location before unlink');
  const { data, error } = await guardian.client.from('guardian_links').delete().eq('id', linkId).select('id');
  expect(!error && data?.length === 1, `guardian unlink failed: ${error?.message}`);
  const afterLoc = await rows(guardian.client, 'guardian_locations', (q) => q.eq('subject_user_id', wearer.id));
  expect(afterLoc.length === 0, 'guardian still sees the location after unlink');
  const afterProfile = await rows(guardian.client, 'profiles', (q) => q.eq('id', wearer.id));
  expect(afterProfile.length === 0, 'guardian still sees the wearer profile after unlink');
  const wearerLinks = await rows(wearer.client, 'guardian_links');
  expect(wearerLinks.length === 0, 'wearer still sees the deleted link');
});

// ---------------------------------------------------------------- cleanup + summary
await cleanupLinksAndLocations();
const gated = results.filter((r) => r.kind === 'CASE');
const failed = gated.filter((r) => !r.ok);
console.log('\n================ LIVE HARNESS SUMMARY ================');
console.log(`gated cases: ${gated.length - failed.length}/${gated.length} PASS`);
for (const r of results.filter((x) => x.kind !== 'CASE')) {
  console.log(`${r.kind}: ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
if (failed.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`- ${f.name}: ${f.detail}`);
}
process.exit(failed.length > 0 ? 1 : 0);
