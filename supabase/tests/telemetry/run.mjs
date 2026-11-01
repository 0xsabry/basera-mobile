/**
 * BASERA telemetry v3 — mandatory test battery against a real local
 * PostgreSQL 16 with the migration applied verbatim.
 * Run: node run.mjs   (expects the scratch cluster on the unix socket)
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const SOCK = '/home/hatch/workspace/.scratch-basera/pgtest';
const pool = new pg.Pool({ host: SOCK, port: 55432, user: 'postgres', database: 'postgres', max: 24 });
const sha = (s) => createHash('sha256').update(s).digest('hex');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

async function ingest(client, { id, secret, facts = {}, events = [] }) {
  const f = {
    platform: 'android', os_version: '34', app_version: '1.1.8', version_code: 10,
    runtime_version: '1.1.0', channel: 'preview', current_update_id: null,
    is_embedded_launch: true, ...facts,
  };
  const { rows } = await client.query(
    `select public.telemetry_ingest($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) as v`,
    [id, sha(secret), f.platform, f.os_version, f.app_version, f.version_code,
     f.runtime_version, f.channel, f.current_update_id, f.is_embedded_launch,
     JSON.stringify(events)],
  );
  return rows[0].v;
}
const ev = (over = {}) => ({
  client_event_id: randomUUID(),
  event_type: 'update_check',
  update_id: null,
  status: 'ok',
  failure_reason: null,
  client_ts: new Date().toISOString(),
  ...over,
});
async function asRole(role, sub, fn) {
  const c = await pool.connect();
  try {
    await c.query(`set role ${role}`);
    if (sub) await c.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub })]);
    else await c.query(`select set_config('request.jwt.claims', '', false)`);
    return await fn(c);
  } finally {
    await c.query('reset role').catch(() => {});
    c.release();
  }
}

// ---------- setup ----------
const admin = await pool.connect();
// Self-reset so the battery is re-runnable on one cluster.
await admin.query('drop schema if exists private cascade; drop schema public cascade; create schema public;');
await admin.query(readFileSync(new URL('./setup.sql', import.meta.url), 'utf8'));
const migration = readFileSync(new URL('../../migrations/20261101000000_telemetry_proposal.sql', import.meta.url), 'utf8');
await admin.query(migration);
// Harness-only emulation of Supabase's platform grants: the real
// service_role can access tables directly (it is the backend role);
// the migration under test deliberately grants it nothing itself.
await admin.query('grant all on public.app_installations, public.app_update_events, public.dashboard_owners to service_role');
console.log('== migration applied cleanly on a fresh database ==');
const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
await admin.query('insert into public.dashboard_owners (user_id) values ($1)', [OWNER]);

// ---------- 1. registration + heartbeat dedupe ----------
console.log('== registration ==');
{
  const A = randomUUID();
  const svc = await pool.connect();
  await svc.query('set role service_role');
  let v = await ingest(svc, { id: A, secret: 'secret-A' });
  check('first register accepted (no error)', !v.error, JSON.stringify(v));
  v = await ingest(svc, { id: A, secret: 'secret-A' });
  check('second launch is a heartbeat, not an error', !v.error);
  const { rows } = await svc.query('select count(*)::int n from public.app_installations where id=$1', [A]);
  check('installation counted exactly once', rows[0].n === 1, `n=${rows[0].n}`);
  v = await ingest(svc, { id: A, secret: 'WRONG-secret' });
  check('wrong secret rejected', v.error === 'secret_mismatch', JSON.stringify(v));
  svc.release();
}

// ---------- 2. strict per-event classification ----------
console.log('== strict validation ==');
{
  const B = randomUUID();
  const svc = await pool.connect();
  await svc.query('set role service_role');
  const good = ev({ event_type: 'update_available', update_id: '33333333-3333-3333-3333-333333333333' });
  const badUid = ev({ update_id: 'not-a-uuid' });
  const badTsFormat = ev({ client_ts: 'yesterday-ish' });
  const badTsWindow = ev({ client_ts: new Date(Date.now() - 3 * 864e5).toISOString() });
  const badStatus = ev({ status: 'maybe' });
  const badReason = ev({ failure_reason: 'x'.repeat(301) });
  const badType = ev({ event_type: 'update_exploded' });
  const missingCid = ev(); delete missingCid.client_event_id;
  const v = await ingest(svc, {
    id: B, secret: 'secret-B',
    events: [good, badUid, badTsFormat, badTsWindow, badStatus, badReason, badType, missingCid],
  });
  check('exactly one event accepted', v.accepted.length === 1 && v.accepted[0] === good.client_event_id, JSON.stringify(v));
  const reasons = Object.fromEntries(v.rejected.map((r) => [r.client_event_id, r.reason]));
  check('invalid_update_id rejected (not nulled)', reasons[badUid.client_event_id] === 'invalid_update_id');
  check('invalid_client_ts rejected', reasons[badTsFormat.client_event_id] === 'invalid_client_ts');
  check('client_ts_out_of_window rejected', reasons[badTsWindow.client_event_id] === 'client_ts_out_of_window');
  check('invalid_status rejected', reasons[badStatus.client_event_id] === 'invalid_status');
  check('failure_reason_too_long rejected', reasons[badReason.client_event_id] === 'failure_reason_too_long');
  check('invalid_event_type rejected', reasons[badType.client_event_id] === 'invalid_event_type');
  check('missing_client_event_id rejected', v.rejected.some((r) => r.reason === 'missing_client_event_id'));
  const { rows } = await svc.query('select count(*)::int n from public.app_update_events where installation_id=$1', [B]);
  check('only the valid event was stored', rows[0].n === 1, `n=${rows[0].n}`);
  svc.release();

  // resend the accepted event -> duplicate, counts unchanged
  const svc2 = await pool.connect();
  await svc2.query('set role service_role');
  const v2 = await ingest(svc2, { id: B, secret: 'secret-B', events: [good] });
  check('resent event classified duplicate', v2.duplicates.length === 1 && v2.accepted.length === 0, JSON.stringify(v2));
  const { rows: r2 } = await svc2.query('select count(*)::int n from public.app_update_events where installation_id=$1', [B]);
  check('duplicate resend stored nothing new', r2[0].n === 1);
  svc2.release();
}

// ---------- 3. atomic budget: duplicates never consume it ----------
console.log('== budget atomicity ==');
{
  const C = randomUUID();
  const svc = await pool.connect();
  await svc.query('set role service_role');
  await ingest(svc, { id: C, secret: 'secret-C' });
  // seed 600 historical events (the full hourly budget)
  const seedEvents = [];
  for (let i = 0; i < 600; i++) seedEvents.push(`('${randomUUID()}','${C}','update_check')`);
  await svc.query(`insert into public.app_update_events (client_event_id, installation_id, event_type) values ${seedEvents.join(',')}`);
  const dup = { client_event_id: null };
  const { rows: oneRow } = await svc.query('select client_event_id from public.app_update_events where installation_id=$1 limit 1', [C]);
  dup.client_event_id = oneRow[0].client_event_id;
  const v = await ingest(svc, {
    id: C, secret: 'secret-C',
    events: [
      { client_event_id: dup.client_event_id, event_type: 'update_check', status: 'ok', client_ts: new Date().toISOString() },
      ev(),
    ],
  });
  check('duplicate still classified duplicate at full budget', v.duplicates.length === 1, JSON.stringify(v));
  check('new event rate_limited at full budget', v.rejected.some((r) => r.reason === 'rate_limited'), JSON.stringify(v));
  check('rate_limited event not stored', v.accepted.length === 0);
  svc.release();
}

// ---------- 4. concurrency: 100 parallel calls, one fresh installation ----------
console.log('== concurrency ==');
{
  const D = randomUUID();
  const calls = [];
  for (let i = 0; i < 100; i++) {
    calls.push((async () => {
      const c = await pool.connect();
      try {
        await c.query('set role service_role');
        return await ingest(c, { id: D, secret: 'secret-D', events: [ev()] });
      } finally { c.release(); }
    })());
  }
  const results = await Promise.all(calls);
  check('no concurrent call errored', results.every((v) => !v.error), JSON.stringify(results.find((v) => v.error)));
  const acceptedTotal = results.reduce((s, v) => s + v.accepted.length, 0);
  check('all 100 events accepted exactly once', acceptedTotal === 100, `accepted=${acceptedTotal}`);
  const { rows } = await admin.query('select (select count(*) from public.app_installations where id=$1)::int inst, (select count(*) from public.app_update_events where installation_id=$1)::int evs', [D]);
  check('exactly one installation row after the race', rows[0].inst === 1 && rows[0].evs === 100, JSON.stringify(rows[0]));
}
{
  // racing first registration with two different secrets
  const E = randomUUID();
  const calls = [];
  for (let i = 0; i < 40; i++) {
    const secret = i % 2 === 0 ? 'secret-E1' : 'secret-E2';
    calls.push((async () => {
      const c = await pool.connect();
      try {
        await c.query('set role service_role');
        const v = await ingest(c, { id: E, secret });
        return v.error ? 'mismatch' : 'ok';
      } finally { c.release(); }
    })());
  }
  const outcomes = await Promise.all(calls);
  const { rows } = await admin.query('select count(*)::int n, count(distinct secret_hash)::int hashes from public.app_installations where id=$1', [E]);
  check('secret race: exactly one installation, one pinned hash', rows[0].n === 1 && rows[0].hashes === 1, JSON.stringify(rows[0]));
  check('secret race: one side fully ok, the other fully rejected',
    (outcomes.filter((o) => o === 'ok').length === 20 && outcomes.filter((o) => o === 'mismatch').length === 20),
    JSON.stringify(outcomes.reduce((a, o) => (a[o] = (a[o] || 0) + 1, a), {})));
}

// ---------- 5. dashboard access control ----------
console.log('== dashboard access ==');
{
  let anonErr = null;
  await asRole('anon', null, async (c) => {
    try { await c.query('select public.dashboard_overview()'); } catch (e) { anonErr = e; }
  });
  check('anon cannot execute dashboard_overview', !!anonErr, anonErr ? '' : 'call succeeded!');

  let otherErr = null;
  await asRole('authenticated', OTHER, async (c) => {
    try { await c.query('select public.dashboard_overview()'); } catch (e) { otherErr = e; }
  });
  check('authenticated non-owner refused by the owner gate', !!otherErr && /not authorized/.test(otherErr.message), otherErr?.message);

  const ov = await asRole('authenticated', OWNER, async (c) => {
    const { rows } = await c.query('select public.dashboard_overview() as v');
    return rows[0].v;
  });
  check('owner receives the overview', typeof ov.total_installations === 'number' && ov.total_installations >= 4, JSON.stringify(ov));

  let tableErr = null;
  await asRole('authenticated', OWNER, async (c) => {
    try { await c.query('select * from public.app_installations limit 1'); } catch (e) { tableErr = e; }
  });
  check('direct table read denied even for the owner (RPC-only)', !!tableErr, tableErr ? '' : 'table readable!');

  let ingestErr = null;
  await asRole('authenticated', OWNER, async (c) => {
    try {
      await c.query(`select public.telemetry_ingest($1,$2,'android',null,null,null,null,null,null,true,'[]'::jsonb)`,
        [randomUUID(), sha('x')]);
    } catch (e) { ingestErr = e; }
  });
  check('authenticated cannot call telemetry_ingest (service_role only)', !!ingestErr, ingestErr ? '' : 'callable!');

  let privErr = null;
  await asRole('authenticated', OWNER, async (c) => {
    try { await c.query('select * from private.dashboard_installations()'); } catch (e) { privErr = e; }
  });
  check('private schema functions are not directly callable', !!privErr, privErr ? '' : 'callable!');
}

// ---------- 6. adoption correctness + duplicate-resend stability ----------
console.log('== adoption funnel ==');
{
  const U = '44444444-4444-4444-4444-444444444444';
  const mk = async (types) => {
    const id = randomUUID();
    const c = await pool.connect();
    await c.query('set role service_role');
    const batch = types.map((t) => ev({ event_type: t, update_id: U }));
    const v = await ingest(c, { id, secret: 's-' + id.slice(0, 8), events: batch });
    c.release();
    return { id, batch, v };
  };
  const X = await mk(['update_available', 'update_downloaded', 'update_applied']);
  await mk(['update_available', 'update_downloaded']);
  await mk(['update_available', 'update_failed']);
  const read = () => asRole('authenticated', OWNER, async (c) => {
    const { rows } = await c.query('select * from public.dashboard_adoption() where update_id=$1', [U]);
    return rows[0];
  });
  const a1 = await read();
  check('funnel counts exact (3/2/1/1, 33.3%)',
    a1 && +a1.discovered === 3 && +a1.downloaded === 2 && +a1.applied === 1 && +a1.failed === 1 && Math.abs(+a1.adoption_pct - 33.3) < 0.01,
    JSON.stringify(a1));
  // resend X's full batch: adoption must not move
  const c = await pool.connect();
  await c.query('set role service_role');
  const v = await ingest(c, { id: X.id, secret: 's-' + X.id.slice(0, 8), events: X.batch });
  c.release();
  check('full-batch resend returns duplicates only', v.duplicates.length === 3 && v.accepted.length === 0, JSON.stringify(v));
  const a2 = await read();
  check('adoption unchanged after duplicate resend',
    JSON.stringify([a2.discovered, a2.downloaded, a2.applied, a2.failed, a2.adoption_pct]) ===
    JSON.stringify([a1.discovered, a1.downloaded, a1.applied, a1.failed, a1.adoption_pct]),
    `${JSON.stringify(a1)} vs ${JSON.stringify(a2)}`);

  // p_limit floor + offset paging
  const page = await asRole('authenticated', OWNER, async (cc) => {
    const { rows } = await cc.query('select * from public.dashboard_installations(null, null, null, 0, 0)');
    return rows;
  });
  check('p_limit=0 floored to >=1 row', page.length >= 1, `rows=${page.length}`);
}

console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
await pool.end();
process.exit(fail ? 1 : 0);
