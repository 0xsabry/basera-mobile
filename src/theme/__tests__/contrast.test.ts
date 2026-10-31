/**
 * WCAG contrast contract for the design system.
 *
 * Every text/background pair the UI actually uses must reach AA
 * (≥ 4.5:1) in BOTH standard palettes; the high-contrast palettes are
 * checked too. Computed programmatically from the token hex values —
 * if a palette edit breaks a pair, this test fails before users do.
 */
import {
  darkColors,
  darkHighContrast,
  lightColors,
  lightHighContrast,
  type ThemeColors,
} from '../tokens';

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground token, background token] pairs used as text on surfaces. */
const TEXT_PAIRS: [keyof ThemeColors, keyof ThemeColors][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceAlt'],
  ['textSecondary', 'background'],
  ['textSecondary', 'surface'],
  ['textSecondary', 'surfaceAlt'],
  ['text', 'primarySoft'],
  ['primaryText', 'primary'],
  ['heroText', 'heroBackground'],
  ['heroTextSecondary', 'heroBackground'],
  ['danger', 'background'],
  ['danger', 'surface'],
  ['success', 'background'],
  ['success', 'surface'],
  ['warning', 'background'],
  ['warning', 'surface'],
  ['info', 'background'],
  ['info', 'surface'],
  ['accent', 'background'],
  ['accent', 'surface'],
  ['tabInactive', 'surface'],
  ['tabActive', 'surface'],
  ['onPrimarySoft', 'primarySoft'],
  ['onDangerSoft', 'dangerSoft'],
  ['onSuccessSoft', 'successSoft'],
  ['onWarningSoft', 'warningSoft'],
  ['onInfoSoft', 'infoSoft'],
];

const PALETTES: [string, ThemeColors][] = [
  ['light', lightColors],
  ['dark', darkColors],
  ['lightHighContrast', lightHighContrast],
  ['darkHighContrast', darkHighContrast],
];

describe('design-system contrast (WCAG AA ≥ 4.5:1)', () => {
  for (const [name, colors] of PALETTES) {
    describe(name, () => {
      for (const [fg, bg] of TEXT_PAIRS) {
        it(`${fg} on ${bg}`, () => {
          expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }
});

/**
 * Bug 5 — bottom tab bar visibility.
 *
 * BEFORE (tints were primary / textSecondary on surface), computed
 * with the helper above:
 *   light            inactive  7.57   active  6.52
 *   dark             inactive 10.13   active  7.38
 *   lightHighContrast inactive 17.40  active  9.96
 *   darkHighContrast inactive 19.44   active 15.19
 * Those ratios pass AA on paper, yet the owner reported the icons
 * barely visible: the glyphs are thin outline forms (◇ ♡ ⌂) whose
 * ~1px strokes at weight 400 wash out on device. The fix therefore
 * holds the dedicated tab tokens to a stronger floor — ≥ 9:1 —
 * not just the 4.5:1 text minimum, for BOTH usages of each tint
 * (icon glyph and label; they share the same tokens).
 *
 * AFTER (tabInactive / tabActive on surface):
 *   light            inactive 12.50   active  9.91
 *   dark             inactive 13.39   active 10.11
 *   lightHighContrast inactive 21.00  active 12.36
 *   darkHighContrast inactive 19.44   active 15.19
 */
const TAB_BAR_MIN = 9;

describe('tab bar contrast (Bug 5: icon + label ≥ 9:1 on surface)', () => {
  for (const [name, colors] of PALETTES) {
    describe(name, () => {
      it('tabInactive on surface (icon glyph)', () => {
        expect(contrastRatio(colors.tabInactive, colors.surface)).toBeGreaterThanOrEqual(TAB_BAR_MIN);
      });
      it('tabInactive on surface (label text)', () => {
        expect(contrastRatio(colors.tabInactive, colors.surface)).toBeGreaterThanOrEqual(TAB_BAR_MIN);
      });
      it('tabActive on surface (icon glyph)', () => {
        expect(contrastRatio(colors.tabActive, colors.surface)).toBeGreaterThanOrEqual(TAB_BAR_MIN);
      });
      it('tabActive on surface (label text)', () => {
        expect(contrastRatio(colors.tabActive, colors.surface)).toBeGreaterThanOrEqual(TAB_BAR_MIN);
      });
    });
  }
});
