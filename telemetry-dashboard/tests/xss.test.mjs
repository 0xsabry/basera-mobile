/**
 * Stored-XSS security tests for telemetry-dashboard/index.html.
 *
 * Threat model: app_version / runtime_version / channel / update ids /
 * event types originate on client devices. The server enforces only
 * length limits (<= 32 chars), never HTML safety, so a hostile device
 * can store strings like `<img src=x onerror=alert(1)>` (28 chars)
 * that a vulnerable dashboard would execute in the owner's browser.
 *
 * Method: load the REAL page into jsdom, stub createClient with
 * attacker-controlled RPC responses, let the page's own script run,
 * then assert the payloads exist only as inert text: no injected
 * elements, no event-handler attributes, alert never fires, and the
 * version filter cannot be broken out of.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`); }
}

// ------------------------------------------------------------------
// Static guards: the vulnerable APIs and the floating CDN tag must
// never come back.
// ------------------------------------------------------------------
// (Property-usage patterns: the page's own comments may NAME the
// banned APIs while explaining the rule; assignments/calls are what
// must never appear.)
check('source contains no innerHTML use', !/\.innerHTML/.test(html));
check('source contains no insertAdjacentHTML use', !/\.insertAdjacentHTML\s*\(/.test(html));
check('source contains no document.write use', !/document\.write\s*\(/.test(html));
check('source contains no outerHTML use', !/\.outerHTML/.test(html));
check(
  'supabase-js pinned to exact 2.118.0',
  /@supabase\/supabase-js@2\.118\.0\/\+esm/.test(html),
);
check('no floating @2 CDN tag remains', !/@supabase\/supabase-js@2\/\+esm/.test(html));

// ------------------------------------------------------------------
// Attack payloads (each <= 32 chars where the server caps length).
// ------------------------------------------------------------------
const IMG = '<img src=x onerror=alert(1)>';
const BREAKOUT = '"><svg onload=alert(2)>';
const SCRIPTY = '<script>alert(3)</scr';
const ATTR = 'v" onmouseover="alert(5)';
const QUOTE = `' OR '1'='1`;

const overview = {
  total_installations: 3,
  active_24h: 1,
  active_7d: 2,
  dormant_7d: 1,
  latest_update_id: SCRIPTY + 'ipt>abcdef',
  by_version: [
    { app_version: IMG, version_code: 10, installations: 2 },
    { app_version: BREAKOUT, version_code: 9, installations: 1 },
  ],
};
const adoption = [
  { update_id: IMG + 'zzzz', discovered: 2, downloaded: 1, applied: 1, failed: 0, adoption_pct: 50.0 },
];
const devices = [
  {
    installation_id: 'abcd1234-5678-90ab-cdef-000000000000',
    app_version: IMG,
    version_code: 10,
    runtime_version: ATTR,
    channel: BREAKOUT,
    last_seen_at: '2026-11-01T10:00:00Z',
    current_update_id: SCRIPTY + 'ipt>abcdef',
    is_embedded_launch: false,
    last_event_type: QUOTE,
    last_event_at: '2026-11-01T10:05:00Z',
  },
  {
    installation_id: 'ffff0000-1111-2222-3333-444444444444',
    app_version: '1.1.8',
    version_code: 10,
    runtime_version: '1.1.0',
    channel: 'preview',
    last_seen_at: '2026-11-01T11:00:00Z',
    current_update_id: null,
    is_embedded_launch: true,
    last_event_type: 'update_applied',
    last_event_at: '2026-11-01T11:05:00Z',
  },
];

// ------------------------------------------------------------------
// Boot the real page script against the stub.
// ------------------------------------------------------------------
const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
check('inline module script found', !!scriptMatch);
const scriptBody = scriptMatch[1]
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('import '))
  .join('\n');

const dom = new JSDOM(html, { url: 'https://dashboard.example/', runScripts: 'outside-only' });
const { window } = dom;
let alertCalls = 0;
window.alert = () => { alertCalls++; };

window.createClient = () => ({
  auth: {
    getSession: async () => ({ data: { session: { user: { email: 'owner@example.com' } } } }),
    signInWithPassword: async () => ({ data: { user: { email: 'owner@example.com' } }, error: null }),
    signOut: async () => ({}),
  },
  rpc: async (fn) => {
    if (fn === 'dashboard_overview') return { data: overview, error: null };
    if (fn === 'dashboard_adoption') return { data: adoption, error: null };
    if (fn === 'dashboard_installations') return { data: devices, error: null };
    return { data: null, error: { message: 'unknown rpc' } };
  },
});

await window.eval(`(async () => {\n${scriptBody}\n})()`);
// Let the async load() chain settle.
for (let i = 0; i < 50 && window.document.querySelectorAll('#devices tr').length < 2; i++) {
  await new Promise((r) => setTimeout(r, 20));
}

const doc = window.document;

// No payload executed or became markup anywhere in the document.
check('alert never fired', alertCalls === 0);
check(
  'no injected img/svg/script/iframe/object/embed elements',
  doc.querySelectorAll('img,svg,iframe,object,embed,script[src]').length === 0,
);
const handlerAttrs = [];
doc.querySelectorAll('*').forEach((n) => {
  for (const a of n.attributes || []) if (/^on/i.test(a.name)) handlerAttrs.push(`${n.tagName}.${a.name}`);
});
check('no on* event-handler attributes anywhere', handlerAttrs.length === 0);

// Versions table: payloads present verbatim as text.
const versionCells = [...doc.querySelectorAll('#versions tr td:first-child')].map((td) => td.textContent);
check('app_version <img> payload rendered as literal text', versionCells[0] === IMG);
check('app_version breakout payload rendered as literal text', versionCells[1] === BREAKOUT);
check('versions table has exactly 2 rows', doc.querySelectorAll('#versions tr').length === 2);

// Filter select: hostile versions cannot break out of the <option>.
const opts = [...doc.querySelectorAll('#fVersion option')];
check('filter has 1 + by_version options', opts.length === 3);
check('filter option value holds payload verbatim (property, not markup)', opts[1].value === IMG);
check('filter option value holds breakout payload verbatim', opts[2].value === BREAKOUT);
check('no elements injected inside the select', doc.querySelectorAll('#fVersion *').length === 3);
check('filter select itself intact', !!doc.querySelector('#fVersion'));

// Cards: latest_update_id payload is text inside the card number.
const cardNums = [...doc.querySelectorAll('#cards .num')].map((n) => n.textContent);
check('latest_update_id truncated payload is literal text', cardNums[4].startsWith('<script>'));

// Adoption: update id payload inert.
const adoptionFirst = doc.querySelector('#adoption tr td:first-child code');
check('adoption update_id payload is literal text', !!adoptionFirst && adoptionFirst.textContent.startsWith('<img src'));

// Devices: every untrusted column inert and verbatim.
const devRows = doc.querySelectorAll('#devices tr');
check('devices table has exactly 2 rows', devRows.length === 2);
const d0 = [...devRows[0].querySelectorAll('td')].map((td) => td.textContent);
check('device app_version payload literal', d0[1].startsWith(IMG));
check('device runtime_version attribute payload literal', d0[2] === ATTR);
check('device channel breakout payload literal', d0[3] === BREAKOUT);
check('device last_event_type quote payload literal', d0[6].startsWith(QUOTE));
check('benign row still renders normally', [...devRows[1].querySelectorAll('td')][3].textContent === 'preview');

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
