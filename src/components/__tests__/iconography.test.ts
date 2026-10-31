/**
 * Iconography regression guard (polish pass, docs/POLISH.md).
 *
 * The owner's core complaint was oversized, heavy decorative icons.
 * This static scan makes that treatment impossible to reintroduce:
 * it walks every .tsx under src/app and src/components and fails on
 *  - any glyph-bearing line whose literal fontSize exceeds the
 *    control token (32) — glyphs render at 16/20/24, control glyphs
 *    (voice disc) at most 32;
 *  - any literal fontSize > 26 anywhere, outside the explicit
 *    whitelist below (each entry is content or a control, never a
 *    decorative icon);
 *  - the old filled-tile glyph scaling expression (size * 0.46)
 *    outside the BrandMark logotype.
 *
 * Whitelist (file + line pattern + reason):
 *  - (tabs)/family.tsx `codeText` — the pairing CODE digits are
 *    content the user must read aloud, not an icon.
 *  - voice.tsx disc glyph line (`discTextColor`) — the microphone
 *    glyph inside the voice CONTROL surface, capped at exactly 32.
 *  - ui.tsx BrandMark `size * 0.52` — the «ب» letterform is the
 *    product logotype, not an icon; header use is 28dp.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', '..');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...tsxFiles(full));
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = [...tsxFiles(path.join(SRC, 'app')), ...tsxFiles(path.join(SRC, 'components'))];

function isWhitelisted(rel: string, line: string, value: number): boolean {
  if (rel.endsWith('(tabs)/family.tsx') && line.includes('codeText')) return true;
  // Voice control glyph: whitelisted ONLY at or below the 32dp cap.
  if (rel.endsWith('app/voice.tsx') && line.includes('discTextColor') && value <= 32) return true;
  return false;
}

describe('iconography guard: no oversized glyphs or icons', () => {
  it('scans a real file set', () => {
    expect(FILES.length).toBeGreaterThan(15);
  });

  it('no glyph line renders above the 32dp control cap', () => {
    const violations: string[] = [];
    for (const file of FILES) {
      const rel = path.relative(SRC, file);
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!/GLYPHS\.|glyph/.test(line)) return;
          const m = line.match(/fontSize:\s*(\d+)/);
          if (m && Number(m[1]) > 32) violations.push(`${rel}:${i + 1} fontSize ${m[1]}`);
        });
    }
    expect(violations).toEqual([]);
  });

  it('no literal fontSize above 26 outside the whitelist', () => {
    const violations: string[] = [];
    for (const file of FILES) {
      const rel = path.relative(SRC, file);
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const m = line.match(/fontSize:\s*(\d+)/);
          if (m && Number(m[1]) > 26 && !isWhitelisted(rel, line, Number(m[1]))) {
            violations.push(`${rel}:${i + 1} fontSize ${m[1]} :: ${line.trim().slice(0, 80)}`);
          }
        });
    }
    expect(violations).toEqual([]);
  });

  it('the filled-tile glyph scaling (size * 0.46) never returns', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const rel = path.relative(SRC, file);
      if (fs.readFileSync(file, 'utf8').includes('0.46')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
