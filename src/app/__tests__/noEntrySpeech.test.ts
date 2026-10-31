/**
 * Silent-entry guard (owner order 2026-11-01): opening the app and
 * switching tabs must NEVER speak. Speech may only answer a direct
 * user action (a tap, a voice command, a scan the user started).
 *
 * This guard statically extracts every useEffect / useFocusEffect body
 * in every app screen and asserts none of them touches the speech
 * service, expo-speech's speak, or the (removed) proximity announcer.
 * The allowlist of entry-path speech effects is EMPTY by design: if a
 * future change needs an exception, it must be debated with the owner,
 * not slipped in here.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readFileSync, readdirSync, statSync } = require('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { join } = require('path') as typeof import('path');

const APP_DIR = join(__dirname, '..');

function screenFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...screenFiles(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Extract the balanced-paren body of every `hook(` call in source. */
function effectBodies(source: string, hook: string): string[] {
  const bodies: string[] = [];
  let idx = 0;
  for (;;) {
    const at = source.indexOf(`${hook}(`, idx);
    if (at < 0) return bodies;
    let depth = 0;
    let end = at + hook.length;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    bodies.push(source.slice(at, end + 1));
    idx = end + 1;
  }
}

const SPEECH_RE = /speechService|Speech\.speak|announceNearbyPlaces/;

describe('silent entry: no speech from mount/focus effects in any screen', () => {
  const files = screenFiles(APP_DIR);
  it('finds the screens to guard', () => {
    expect(files.length).toBeGreaterThan(10);
  });
  for (const file of files) {
    const rel = file.slice(APP_DIR.length + 1);
    it(`${rel}: no useEffect/useFocusEffect body speaks`, () => {
      const src = readFileSync(file, 'utf8');
      for (const hook of ['useEffect', 'useFocusEffect']) {
        for (const body of effectBodies(src, hook)) {
          expect(body).not.toMatch(SPEECH_RE);
        }
      }
    });
  }
});

describe('silent entry: the focus-triggered proximity announcer is gone', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync: read } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join: j } = require('path') as typeof import('path');

  it('Home and Places no longer reference announceNearbyPlaces', () => {
    const home = read(j(__dirname, '..', '(tabs)', 'index.tsx'), 'utf8');
    const places = read(j(__dirname, '..', 'places.tsx'), 'utf8');
    expect(home).not.toContain('announceNearbyPlaces');
    expect(places).not.toContain('announceNearbyPlaces');
  });

  it('the proximity module no longer speaks at all', () => {
    const raw = read(j(__dirname, '..', '..', 'places', 'proximity.ts'), 'utf8');
    // Code only — the module's doc comment names the removed function
    // to record why it is gone; that prose must not trip the guard.
    const prox = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(prox).not.toContain('announceNearbyPlaces');
    expect(prox).not.toContain('speechService');
    expect(prox).not.toContain('speakAnnouncement');
  });
});
