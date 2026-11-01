/**
 * telemetry-ingest core tests (Node, type-stripped import of the real
 * core.ts shipped with the function).
 */
import assert from 'node:assert';

const core = await import(
  '../../functions/telemetry-ingest/core.ts'
);
const { readBodyWithCap, checkBatch, validateFacts, mapIngestResult, BodyTooLargeError, MAX_BODY_BYTES } = core;

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};

function streamOf(chunks, counter) {
  return new ReadableStream({
    pull(controller) {
      if (counter) counter.pulls++;
      const next = chunks.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
  });
}
const bytes = (n, fill = 97) => new Uint8Array(n).fill(fill);

// --- streaming cap, counted in BYTES, aborted early ---
{
  const counter = { pulls: 0 };
  const chunks = Array.from({ length: 10 }, () => bytes(16384)); // 160KB total
  let threw = null;
  try {
    await readBodyWithCap(streamOf(chunks, counter), MAX_BODY_BYTES);
  } catch (e) { threw = e; }
  check('oversized stream rejected with BodyTooLargeError', threw instanceof BodyTooLargeError);
  check('stream aborted early, never fully consumed', counter.pulls <= 5, `pulls=${counter.pulls}`);
}
{
  // No Content-Length involved at all: the stream itself is the truth.
  const exact = await readBodyWithCap(streamOf([bytes(MAX_BODY_BYTES)]), MAX_BODY_BYTES);
  check('exactly 65536 bytes accepted', exact.length === MAX_BODY_BYTES);
  let threw = null;
  try { await readBodyWithCap(streamOf([bytes(MAX_BODY_BYTES + 1)]), MAX_BODY_BYTES); }
  catch (e) { threw = e; }
  check('65537 bytes rejected', threw instanceof BodyTooLargeError);
  check('absent body reads as empty', (await readBodyWithCap(null)) === '');
}
{
  // Arabic text: 2 bytes per char in UTF-8 — the cap counts BYTES.
  const arabic = 'ب'.repeat(40000); // 80,000 bytes
  const enc = new TextEncoder().encode(arabic);
  let threw = null;
  try { await readBodyWithCap(streamOf([enc]), MAX_BODY_BYTES); } catch (e) { threw = e; }
  check('multibyte body capped by bytes, not characters', threw instanceof BodyTooLargeError);
}

// --- batch gate ---
check('batch of 50 allowed', checkBatch(new Array(50)) === null);
{
  const r = checkBatch(new Array(51));
  check('batch of 51 hard-rejected', r && r.error === 'batch_too_large' && r.received === 51, JSON.stringify(r));
}

// --- fact validation ---
check('invalid platform rejected', validateFacts({ platform: 'windows' }).error === 'invalid_platform');
check('fractional version_code rejected', validateFacts({ version_code: 1.5 }).error === 'invalid_version_code');
check('huge version_code rejected', validateFacts({ version_code: 100000 }).error === 'invalid_version_code');
check('malformed current_update_id rejected', validateFacts({ current_update_id: 'zzz' }).error === 'invalid_current_update_id');
{
  const ok = validateFacts({
    platform: 'android', app_version: '1.1.8', version_code: 10,
    runtime_version: '1.1.0', channel: 'preview',
    current_update_id: '33333333-3333-3333-3333-333333333333', is_embedded_launch: false,
  });
  check('valid facts normalized for the RPC', !ok.error && ok.facts.p_version_code === 10 && ok.facts.p_is_embedded_launch === false, JSON.stringify(ok));
}

// --- verdict mapping ---
check('secret_mismatch maps to 403', mapIngestResult({ error: 'secret_mismatch' }).status === 403);
{
  const m = mapIngestResult({ accepted: ['a'], duplicates: ['d'], rejected: [{ client_event_id: 'x', reason: 'invalid_update_id' }] });
  check('verdict maps to 200 with all three lists', m.status === 200 && m.body.accepted.length === 1 && m.body.duplicates.length === 1 && m.body.rejected.length === 1);
}

console.log(`\n==== CORE RESULT: ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
