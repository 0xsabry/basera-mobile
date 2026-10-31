/**
 * Static scan (Bug 2 audit): UI strings in src/app screens must go
 * through t() from src/i18n/strings.ts — a hardcoded literal bypasses
 * the language switch entirely and stays in the old language.
 *
 * Pragmatic rules, per scanned line (comment lines are skipped):
 *  1. Any Arabic-script character inside a string literal / JSX text.
 *  2. Any quoted multi-word English literal (Capitalized phrase) — the
 *     shape of a UI label/sentence passed directly to a label prop,
 *     a <Text> node, or a speech call instead of t().
 *
 * Every exception is an explicit WHITELIST entry below with a
 * justification. Entries marked KNOWN-DEBT are real leaks that live in
 * files outside the Bug-2 change's ownership; they are enumerated here
 * (and in the change report) so they stay visible until fixed — they
 * are NOT considered acceptable patterns for new code.
 */
import * as fs from 'fs';
import * as path from 'path';

const APP_DIR = path.resolve(__dirname, '../../app');

interface WhitelistEntry {
  /** Path relative to src/app, e.g. '(tabs)/history.tsx'. */
  file: string;
  /** Substring that must appear on the exempted line. */
  includes: string;
  kind: 'brand' | 'proper-noun' | 'non-ui-logic' | 'known-debt';
  justification: string;
}

const WHITELIST: WhitelistEntry[] = [
  {
    file: '(tabs)/settings.tsx',
    includes: 'العربية',
    kind: 'proper-noun',
    justification:
      'Language-picker endonym: a language is labelled in its own language by convention (pairs with the literal English label on the next option).',
  },
  {
    file: 'onboarding.tsx',
    includes: 'العربية',
    kind: 'proper-noun',
    justification: 'Same language-picker endonym as in settings.tsx.',
  },
  {
    file: 'voice.tsx',
    includes: 'أيوه',
    kind: 'non-ui-logic',
    justification:
      'Speech-recognition vocabulary: a regex matching spoken yes-words (yes/yeah/ok/أيوه/ايوه/نعم/تمام). Never displayed or spoken as UI copy.',
  },
  // All four former KNOWN-DEBT entries (history back label, onboarding
  // spoken welcome, read.tsx OCR prefix, voice.tsx language confirmation)
  // were FIXED in the bug-fix release integration: they now use t() keys
  // (backToHistory, welcomeSpoken, ocrSpokenPrefix, languageChangedConfirm),
  // so their exemptions were removed — the staleness guard below proves it.
];

const ARABIC_RE = /[\u0600-\u06FF]/;
const ENGLISH_UI_RE = /['"`]([A-Z][a-z]+(?: [A-Za-z0-9]+)+)['"`]/;

function collectTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTsx(full));
    else if (entry.isFile() && entry.name.endsWith('.tsx')) out.push(full);
  }
  return out.sort();
}

function isCommentLine(line: string): boolean {
  const s = line.trimStart();
  return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*');
}

function isWhitelisted(relFile: string, line: string): boolean {
  return WHITELIST.some((w) => w.file === relFile && line.includes(w.includes));
}

describe('hardcoded UI strings in src/app', () => {
  it('exposes no Arabic or English UI literals outside t() (beyond the whitelist)', () => {
    const violations: string[] = [];
    for (const file of collectTsx(APP_DIR)) {
      const relFile = path.relative(APP_DIR, file);
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (isCommentLine(line)) return;
        if (isWhitelisted(relFile, line)) return;
        if (ARABIC_RE.test(line)) {
          violations.push(`${relFile}:${idx + 1} Arabic literal: ${line.trim()}`);
        } else if (ENGLISH_UI_RE.test(line)) {
          violations.push(`${relFile}:${idx + 1} English UI literal: ${line.trim()}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it('whitelist entries still match real lines (no stale exemptions)', () => {
    for (const w of WHITELIST) {
      const full = path.join(APP_DIR, w.file);
      const content = fs.readFileSync(full, 'utf8');
      expect(content.includes(w.includes)).toBe(true);
    }
  });
});
