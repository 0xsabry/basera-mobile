/**
 * BASERA telemetry v5 — mandatory test battery against a real local
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

const FACTS = {
  platform: 'android', os_version: '34', app_version: '1.1.8', version_code: 10,
  runtime_version: '1.1.0', channel: 'preview', current_update_id: null,
  is_embedded_launch: true,
};
async function bootstrap(client, facts = {}) {
  const f = { ...FACTS, ...facts };
  const { rows } = await client.query(
    `select public.telemetry_bootstrap($1,$2,$3,$4,$5,$6,$7,$8) as v`,
    [f.platform, f.os_version, f.app_version, f.version_code, f.runtime_version,
     f.channel, f.current_update_id, f.is_embedded_launch]);
  return rows[0].v;
}
async function ingest(client, { id, secret, facts = {}, events = [], poolRequest }) {
  const f = { ...FACTS, ...facts };
  const sql = poolRequest === undefined
    ? `select public.telemetry_ingest($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) as v`
    : `select public.telemetry_ingest($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) as v`;
  const params = [id, sha(secret), f.platform, f.os_version, f.app_version, f.version_code,
     f.runtime_version, f.channel, f.current_update_id, f.is_embedded_launch,
     JSON.stringify(events)];
  if (poolRequest !== undefined) params.push(poolRequest);
  const { rows } = await client.query(sql, params);
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
async function svcClient() {
  const c = await pool.connect();
  await c.query('set role service_role');
  return c;
}

// ---------- setup ----------
const admin = await pool.connect();
await admin.query('drop schema if exists basera_telemetry_private cascade; drop schema if exists private cascade; drop schema public cascade; create schema public;');
await admin.query(readFileSync(new URL('./setup.sql', import.meta.url), 'utf8'));
const migration = readFileSync('/home/hatch/workspace/basera/supabase/migrations/20261101000000_telemetry_proposal.sql', 'utf8');
await admin.query(migration);
await admin.query('grant all on public.app_installations, public.app_update_events, public.dashboard_owners to service_role');
console.log('== migration applied cleanly on a fresh database ==');
const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
await admin.query('insert into public.dashboard_owners (user_id) values ($1)', [OWNER]);

// ---------- 1. server-issued identity (bootstrap) ----------
console.log('== bootstrap identity ==');
let A;
{
  const svc = await svcClient();
  A = await bootstrap(svc);
  check('bootstrap returns id + secret + pool',
    !!A.installation_id && typeof A.secret === 'string' && A.secret.length === 64 &&
    Array.isArray(A.event_id_pool) && A.event_id_pool.length === 100, JSON.stringify(A).slice(0, 120));
  const B = await bootstrap(svc);
  check('every bootstrap issues an independent id and secret',
    B.installation_id !== A.installation_id && B.secret !== A.secret);
  // The returned secret must authenticate: the SQL-side stored hash is
  // sha256(secret) — the ingest path hashes in the caller and compares.
  let v = await ingest(svc, { id: A.installation_id, secret: A.secret });
  check('issued secret authenticates ingest (hash contract holds)', !v.error, JSON.stringify(v));
  check('a heartbeat that asks for no ids is granted none',
    Array.isArray(v.event_id_pool) && v.event_id_pool.length === 0);
  v = await ingest(svc, { id: A.installation_id, secret: A.secret, poolRequest: 30 });
  check('a sized pool request is granted exactly',
    Array.isArray(v.event_id_pool) && v.event_id_pool.length === 30);
  v = await ingest(svc, { id: A.installation_id, secret: A.secret, poolRequest: 5000 });
  check('an oversized pool request is clamped to 100 server-side',
    Array.isArray(v.event_id_pool) && v.event_id_pool.length === 100);
  v = await ingest(svc, { id: A.installation_id, secret: A.secret });
  const { rows } = await svc.query('select count(*)::int n from public.app_installations where id=$1', [A.installation_id]);
  check('repeat launches are heartbeats; installation counted once', rows[0].n === 1 && !v.error);
  v = await ingest(svc, { id: A.installation_id, secret: 'WRONG-secret' });
  check('wrong secret rejected', v.error === 'secret_mismatch', JSON.stringify(v));
  v = await ingest(svc, { id: randomUUID(), secret: 'never-issued-secret' });
  check('unissued id refused as unknown_installation', v.error === 'unknown_installation', JSON.stringify(v));
  const { rows: none } = await svc.query('select count(*)::int n from public.app_installations');
  check('refused ingest created no row', none[0].n === 2, `n=${none[0].n}`);
  svc.release();
}

// ---------- 2. is_embedded_launch tri-state at the SQL layer ----------
console.log('== embedded tri-state ==');
{
  const svc = await svcClient();
  const issued = await bootstrap(svc, { is_embedded_launch: null });
  const { rows } = await svc.query('select is_embedded_launch from public.app_installations where id=$1', [issued.installation_id]);
  check('absent fact stays NULL (unknown), never coerced', rows[0].is_embedded_launch === null, JSON.stringify(rows[0]));
  await ingest(svc, { id: issued.installation_id, secret: issued.secret, facts: { is_embedded_launch: null } });
  const { rows: r2 } = await svc.query('select is_embedded_launch from public.app_installations where id=$1', [issued.installation_id]);
  check('null heartbeat does not overwrite unknown with a guess', r2[0].is_embedded_launch === null);
  await ingest(svc, { id: issued.installation_id, secret: issued.secret, facts: { is_embedded_launch: false } });
  const { rows: r3 } = await svc.query('select is_embedded_launch from public.app_installations where id=$1', [issued.installation_id]);
  check('a real boolean is stored as-is', r3[0].is_embedded_launch === false);
  await ingest(svc, { id: issued.installation_id, secret: issued.secret, facts: { is_embedded_launch: null } });
  const { rows: r4 } = await svc.query('select is_embedded_launch from public.app_installations where id=$1', [issued.installation_id]);
  check('later unknown does not erase a known value', r4[0].is_embedded_launch === false);
  svc.release();
}

// ---------- 3. strict per-event classification ----------
console.log('== strict validation ==');
{
  const svc = await svcClient();
  const B = await bootstrap(svc);
  const good = ev({ event_type: 'update_available', update_id: '33333333-3333-3333-3333-333333333333' });
  const badUid = ev({ update_id: 'not-a-uuid' });
  const badTsFormat = ev({ client_ts: 'yesterday-ish' });
  const badTsWindow = ev({ client_ts: new Date(Date.now() - 3 * 864e5).toISOString() });
  const badStatus = ev({ status: 'maybe' });
  const badReason = ev({ failure_reason: 'x'.repeat(301) });
  const badType = ev({ event_type: 'update_exploded' });
  const missingCid = ev(); delete missingCid.client_event_id;
  const v = await ingest(svc, {
    id: B.installation_id, secret: B.secret,
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
  const { rows } = await svc.query('select count(*)::int n from public.app_update_events where installation_id=$1', [B.installation_id]);
  check('only the valid event was stored', rows[0].n === 1, `n=${rows[0].n}`);
  const v2 = await ingest(svc, { id: B.installation_id, secret: B.secret, events: [good] });
  check('resent event classified duplicate', v2.duplicates.length === 1 && v2.accepted.length === 0, JSON.stringify(v2));
  const { rows: r2 } = await svc.query('select count(*)::int n from public.app_update_events where installation_id=$1', [B.installation_id]);
  check('duplicate resend stored nothing new', r2[0].n === 1);
  svc.release();
}

// ---------- 4. atomic budget ----------
console.log('== budget atomicity ==');
{
  const svc = await svcClient();
  const C = await bootstrap(svc);
  const seedEvents = [];
  for (let i = 0; i < 600; i++) seedEvents.push(`('${randomUUID()}','${C.installation_id}','update_check')`);
  await svc.query(`insert into public.app_update_events (client_event_id, installation_id, event_type) values ${seedEvents.join(',')}`);
  const { rows: oneRow } = await svc.query('select client_event_id from public.app_update_events where installation_id=$1 limit 1', [C.installation_id]);
  const v = await ingest(svc, {
    id: C.installation_id, secret: C.secret,
    events: [
      { client_event_id: oneRow[0].client_event_id, event_type: 'update_check', status: 'ok', client_ts: new Date().toISOString() },
      ev(),
    ],
  });
  check('duplicate still classified duplicate at full budget', v.duplicates.length === 1, JSON.stringify(v));
  check('new event rate_limited at full budget', v.rejected.some((r) => r.reason === 'rate_limited'), JSON.stringify(v));
  check('rate_limited event not stored', v.accepted.length === 0);
  svc.release();
}

// ---------- 5. concurrency ----------
console.log('== concurrency ==');
{
  const svc = await svcClient();
  const D = await bootstrap(svc);
  svc.release();
  const calls = [];
  for (let i = 0; i < 100; i++) {
    calls.push((async () => {
      const c = await svcClient();
      try { return await ingest(c, { id: D.installation_id, secret: D.secret, events: [ev()] }); }
      finally { c.release(); }
    })());
  }
  const results = await Promise.all(calls);
  check('no concurrent ingest errored', results.every((v) => !v.error), JSON.stringify(results.find((v) => v.error)));
  check('all 100 events accepted exactly once',
    results.reduce((s, v) => s + v.accepted.length, 0) === 100);
  const { rows } = await admin.query('select (select count(*) from public.app_installations where id=$1)::int inst, (select count(*) from public.app_update_events where installation_id=$1)::int evs', [D.installation_id]);
  check('exactly one installation row after the race', rows[0].inst === 1 && rows[0].evs === 100, JSON.stringify(rows[0]));

  const boots = [];
  for (let i = 0; i < 40; i++) {
    boots.push((async () => {
      const c = await svcClient();
      try { return await bootstrap(c); } finally { c.release(); }
    })());
  }
  const issued = await Promise.all(boots);
  check('40 concurrent bootstraps issue 40 distinct identities',
    new Set(issued.map((b) => b.installation_id)).size === 40 &&
    new Set(issued.map((b) => b.secret)).size === 40);
}

// ---------- 6. dashboard access control ----------
console.log('== dashboard access ==');
{
  let anonErr = null;
  await asRole('anon', null, async (c) => {
    try { await c.query('select public.dashboard_overview()'); } catch (e) { anonErr = e; }
  });
  check('anon cannot execute dashboard_overview', !!anonErr);

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
  check('direct table read denied even for the owner (RPC-only)', !!tableErr);

  let ingestErr = null, bootErr = null;
  await asRole('authenticated', OWNER, async (c) => {
    try { await c.query(`select public.telemetry_ingest($1,$2,'android',null,null,null,null,null,null,true,'[]'::jsonb)`, [randomUUID(), sha('x')]); } catch (e) { ingestErr = e; }
    try { await c.query(`select public.telemetry_bootstrap('android',null,null,null,null,null,null,true)`); } catch (e) { bootErr = e; }
  });
  check('authenticated cannot call telemetry_ingest or telemetry_bootstrap', !!ingestErr && !!bootErr);

  let privAnonErr = null;
  await asRole('anon', null, async (c) => {
    try { await c.query('select * from basera_telemetry_private.dashboard_installations()'); } catch (e) { privAnonErr = e; }
  });
  check('anon cannot execute the private functions at all', !!privAnonErr);

  let privGateErr = null;
  await asRole('authenticated', OTHER, async (c) => {
    try { await c.query('select * from basera_telemetry_private.dashboard_installations()'); } catch (e) { privGateErr = e; }
  });
  check('direct private call by a non-owner still hits the owner gate',
    !!privGateErr && /not authorized/.test(privGateErr.message), privGateErr?.message);

  const { rows: posture } = await admin.query(
    `select n.nspname || '.' || p.proname as key, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where (n.nspname = 'public' and p.proname in ('dashboard_overview','dashboard_adoption','dashboard_installations','telemetry_ingest','telemetry_bootstrap'))
        or (n.nspname = 'basera_telemetry_private')`);
  const def = Object.fromEntries(posture.map((r) => [r.key, r.prosecdef]));
  check('public wrappers are SECURITY INVOKER (definer=false)',
    def['public.dashboard_overview'] === false && def['public.dashboard_adoption'] === false && def['public.dashboard_installations'] === false, JSON.stringify(def));
  check('ingest + bootstrap + private implementations are SECURITY DEFINER',
    def['public.telemetry_ingest'] === true && def['public.telemetry_bootstrap'] === true &&
    def['basera_telemetry_private.is_dashboard_owner'] === true && def['basera_telemetry_private.dashboard_installations'] === true,
    JSON.stringify(def));
}

// ---------- 7. adoption funnel ----------
console.log('== adoption funnel ==');
{
  const U = '44444444-4444-4444-4444-444444444444';
  const mk = async (types) => {
    const c = await svcClient();
    const issued = await bootstrap(c);
    const batch = types.map((t) => ev({ event_type: t, update_id: U }));
    const v = await ingest(c, { id: issued.installation_id, secret: issued.secret, events: batch });
    c.release();
    return { issued, batch, v };
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
  const c = await svcClient();
  const v = await ingest(c, { id: X.issued.installation_id, secret: X.issued.secret, events: X.batch });
  c.release();
  check('full-batch resend returns duplicates only', v.duplicates.length === 3 && v.accepted.length === 0, JSON.stringify(v));
  const a2 = await read();
  check('adoption unchanged after duplicate resend',
    JSON.stringify([a2.discovered, a2.downloaded, a2.applied, a2.failed, a2.adoption_pct]) ===
    JSON.stringify([a1.discovered, a1.downloaded, a1.applied, a1.failed, a1.adoption_pct]));
  const page = await asRole('authenticated', OWNER, async (cc) => {
    const { rows } = await cc.query('select * from public.dashboard_installations(null, null, null, 0, 0)');
    return rows;
  });
  check('p_limit=0 floored to >=1 row', page.length >= 1, `rows=${page.length}`);
}

// ---------- 8. strict envelope & field types ----------
console.log('== strict envelope & field types ==');
{
  const svc = await svcClient();
  const F = await bootstrap(svc);
  const callRaw = async (id, secret, eventsJson) => {
    const { rows } = await svc.query(
      `select public.telemetry_ingest($1,$2,'android',null,'1.1.8',10,'1.1.0','preview',null,true,$3::jsonb) as v`,
      [id, sha(secret), eventsJson]);
    return rows[0].v;
  };
  const { rows: before } = await svc.query('select last_seen_at from public.app_installations where id=$1', [F.installation_id]);
  let v = await callRaw(F.installation_id, F.secret, 'null');
  check('p_events null -> invalid_events', v.error === 'invalid_events', JSON.stringify(v));
  v = await callRaw(F.installation_id, F.secret, '{"a":1}');
  check('p_events object -> invalid_events', v.error === 'invalid_events', JSON.stringify(v));
  v = await callRaw(F.installation_id, F.secret, JSON.stringify(Array.from({ length: 51 }, () => ev())));
  check('p_events 51 entries -> batch_too_large', v.error === 'batch_too_large', JSON.stringify(v));
  const { rows: after } = await svc.query('select last_seen_at from public.app_installations where id=$1', [F.installation_id]);
  check('malformed requests recorded NO heartbeat', String(after[0].last_seen_at) === String(before[0].last_seen_at),
    `${before[0].last_seen_at} vs ${after[0].last_seen_at}`);
  v = await callRaw(F.installation_id, F.secret, '[]');
  check('empty events array is a valid heartbeat', !v.error, JSON.stringify(v));

  const G = await bootstrap(svc);
  v = await ingest(svc, { id: G.installation_id, secret: G.secret, events: [
    ev({ failure_reason: 42 }),
    ev({ status: true }),
    42,
    ev({ event_type: 'update_available', update_id: '33333333-3333-3333-3333-333333333333' }),
  ] });
  const byReason = Object.fromEntries(v.rejected.map((r) => [r.reason, r]));
  check('numeric failure_reason / boolean status rejected as invalid_field_type',
    v.rejected.filter((r) => r.reason === 'invalid_field_type').length === 2, JSON.stringify(v.rejected));
  check('non-object event element rejected as invalid_event_shape', !!byReason.invalid_event_shape, JSON.stringify(v.rejected));
  check('the one valid sibling was accepted', v.accepted.length === 1, JSON.stringify(v));
  svc.release();
}

// ---------- 9. registration circuit breaker (bootstrap) ----------
console.log('== registration circuit breaker ==');
{
  const svc = await svcClient();
  const existing = await bootstrap(svc);
  const vals = [];
  for (let i = 0; i < 500; i++) vals.push(`('${randomUUID()}','${sha('seed-' + i)}')`);
  await svc.query(`insert into public.app_installations (id, secret_hash) values ${vals.join(',')}`);
  const v = await bootstrap(svc);
  check('bootstrap throttled at 500 registrations/hour', v.error === 'registration_throttled', JSON.stringify(v));
  const v2 = await ingest(svc, { id: existing.installation_id, secret: existing.secret });
  check('existing installations are unaffected by the breaker', !v2.error, JSON.stringify(v2));
  svc.release();
}

console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
