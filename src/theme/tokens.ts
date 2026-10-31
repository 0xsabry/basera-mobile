/**
 * BASERA design tokens — V1.1 premium design system.
 *
 * One source of truth for color, spacing, radius, elevation and type.
 * Every screen composes the shared primitives in src/components/ui.tsx
 * from these tokens; screens never hard-code hex values.
 *
 * Accessibility contract:
 * - Every text/background pair in the standard light and dark palettes
 *   is verified ≥ 4.5:1 (WCAG AA) by src/theme/__tests__/contrast.test.ts.
 * - Status is always icon glyph + text, never color alone.
 * - Touch targets are ≥ 56dp (MIN_TOUCH), primary actions 64dp+.
 */

/** 4pt spacing scale. */
export const spacing = { xxs: 4, xs: 6, sm: 10, md: 16, lg: 24, xl: 32, xxl: 40 };
/**
 * Radius hierarchy — surfaces must be distinguishable by shape, not
 * just by borders: hero 24, card 16, row/tile 14, chip/pill full.
 * `xl` stays 24 (hero alias) so existing hero references keep meaning;
 * `card` / `row` are the workhorse values for the quiet surfaces.
 */
export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 24, hero: 24, card: 16, row: 14, pill: 999 };
/** Minimum touch target: 60dp (above the 48dp platform minimum). */
export const MIN_TOUCH = 60;
export const BUTTON_HEIGHT = 64;

/**
 * Icon sizes — the ONLY sizes a glyph icon may render at (polish
 * pass, docs/POLISH.md). Icons support the interface quietly: small,
 * light-weight, monochrome or one muted accent, never inside filled
 * decorative tiles. `control` is reserved for the glyph inside an
 * actual control surface (voice disc, camera shutter) — decoration
 * may never use it. Touch targets stay ≥48dp via padding/layout;
 * the visible glyph stays small.
 */
export const iconSize = { sm: 16, md: 20, lg: 24, control: 32 } as const;
export type IconSize = (typeof iconSize)[keyof typeof iconSize];

/**
 * Elevation discipline — the default card is FLAT (elevation 0, a 1px
 * border carries the separation). Elevation is spent only on the one
 * `raised` surface per screen and on the hero action.
 */
export const elevation = { card: 0, flat: 0, raised: 5, hero: 8 };

export const typeScale = {
  display: 34,
  title: 30,
  heading: 24,
  body: 19,
  bodyLarge: 21,
  caption: 16,
  button: 20,
};

export type TypeScale = typeof typeScale;

/** User-selectable larger-text scale (Settings → Language & Appearance). */
export type TextScaleOption = 1 | 1.15 | 1.3;
export const TEXT_SCALE_OPTIONS: TextScaleOption[] = [1, 1.15, 1.3];

/** Returns a copy of the base type scale with every size multiplied. */
export function scaledType(scale: TextScaleOption): TypeScale {
  if (scale === 1) return typeScale;
  const out = {} as Record<keyof TypeScale, number>;
  (Object.keys(typeScale) as (keyof TypeScale)[]).forEach((k) => {
    out[k] = Math.round(typeScale[k] * scale);
  });
  return out;
}

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textSecondary: string;
  primary: string;
  primaryText: string;
  /**
   * Bottom tab bar tints (Bug 5). Dedicated tokens, NOT aliases of
   * primary/textSecondary: the tab glyphs are thin outline forms
   * (◇ ♡ ⌂) whose ~1px strokes wash out on device even when the
   * raw color ratio passes AA, so both tints are held to ≥ 9:1
   * against `surface` (the bar background) in every palette —
   * verified in contrast.test.ts.
   */
  tabActive: string;
  tabInactive: string;
  accent: string;
  danger: string;
  /** Semantic status colors — always paired with text, never color alone. */
  success: string;
  warning: string;
  info: string;
  border: string;
  overlayBox: string;
  /** Soft tints for icon tiles / status pills, with their "on" text colors. */
  primarySoft: string;
  onPrimarySoft: string;
  dangerSoft: string;
  onDangerSoft: string;
  successSoft: string;
  onSuccessSoft: string;
  warningSoft: string;
  onWarningSoft: string;
  infoSoft: string;
  onInfoSoft: string;
  /** Hero (primary action) surface. */
  heroBackground: string;
  heroText: string;
  heroTextSecondary: string;
  /** Drop-shadow color for elevated surfaces. */
  shadow: string;
}

export const lightColors: ThemeColors = {
  background: '#F5F7F6',
  surface: '#FFFFFF',
  surfaceAlt: '#E8EFEB',
  text: '#0B1F18',
  textSecondary: '#3D5A4F',
  primary: '#0A6B4C',
  primaryText: '#FFFFFF',
  tabActive: '#064D34',
  tabInactive: '#24382E',
  accent: '#7C4D00',
  danger: '#B3261E',
  success: '#14632C',
  warning: '#7C4D00',
  info: '#0B5394',
  border: '#5A7264',
  overlayBox: '#0A6B4C',
  primarySoft: '#DCEBE2',
  onPrimarySoft: '#0A4A34',
  dangerSoft: '#F9DEDC',
  onDangerSoft: '#7A1A14',
  successSoft: '#D8EDDD',
  onSuccessSoft: '#0B4A20',
  warningSoft: '#F5E7C8',
  onWarningSoft: '#5C3A00',
  infoSoft: '#D9E8F7',
  onInfoSoft: '#083E6E',
  heroBackground: '#0A6B4C',
  heroText: '#FFFFFF',
  heroTextSecondary: '#DCEBE2',
  shadow: 'rgba(9, 30, 22, 0.14)',
};

export const darkColors: ThemeColors = {
  background: '#0A100D',
  surface: '#131D17',
  surfaceAlt: '#1D2A22',
  text: '#F2F7F4',
  textSecondary: '#B4CCBE',
  primary: '#2FBF8F',
  primaryText: '#03130B',
  tabActive: '#4ADEA6',
  tabInactive: '#D8E6DD',
  accent: '#FFC44D',
  danger: '#FF8A80',
  success: '#4CC38A',
  warning: '#FFC44D',
  info: '#6CB2F5',
  border: '#4A6A58',
  overlayBox: '#2FBF8F',
  primarySoft: '#173528',
  onPrimarySoft: '#7FE3BC',
  dangerSoft: '#3D1A16',
  onDangerSoft: '#FFB4A8',
  successSoft: '#14301F',
  onSuccessSoft: '#8FE8B0',
  warningSoft: '#38300F',
  onWarningSoft: '#FFD968',
  infoSoft: '#12293D',
  onInfoSoft: '#8FC6F8',
  heroBackground: '#2FBF8F',
  heroText: '#03130B',
  heroTextSecondary: '#052E1D',
  shadow: 'rgba(0, 0, 0, 0.5)',
};

/** High-contrast variants push text/background to extremes. */
export const lightHighContrast: ThemeColors = {
  ...lightColors,
  text: '#000000',
  textSecondary: '#1A1A1A',
  border: '#000000',
  primary: '#004D33',
  tabActive: '#003D29',
  tabInactive: '#000000',
  success: '#00511F',
  warning: '#5C3A00',
  info: '#003B73',
  danger: '#8F130C',
  accent: '#5C3A00',
  primarySoft: '#FFFFFF',
  onPrimarySoft: '#004D33',
  dangerSoft: '#FFFFFF',
  onDangerSoft: '#8F130C',
  successSoft: '#FFFFFF',
  onSuccessSoft: '#00511F',
  warningSoft: '#FFFFFF',
  onWarningSoft: '#5C3A00',
  infoSoft: '#FFFFFF',
  onInfoSoft: '#003B73',
  heroBackground: '#004D33',
  heroText: '#FFFFFF',
  heroTextSecondary: '#DCEBE2',
};

export const darkHighContrast: ThemeColors = {
  ...darkColors,
  background: '#000000',
  surface: '#0D0D0D',
  surfaceAlt: '#1A1A1A',
  text: '#FFFFFF',
  textSecondary: '#FFFFFF',
  border: '#FFFFFF',
  primary: '#4DFFC3',
  primaryText: '#00150C',
  tabActive: '#4DFFC3',
  tabInactive: '#FFFFFF',
  success: '#00FF9D',
  warning: '#FFE14D',
  info: '#66CCFF',
  danger: '#FF6D60',
  accent: '#FFE14D',
  primarySoft: '#0D0D0D',
  onPrimarySoft: '#4DFFC3',
  dangerSoft: '#0D0D0D',
  onDangerSoft: '#FF6D60',
  successSoft: '#0D0D0D',
  onSuccessSoft: '#00FF9D',
  warningSoft: '#0D0D0D',
  onWarningSoft: '#FFE14D',
  infoSoft: '#0D0D0D',
  onInfoSoft: '#66CCFF',
  heroBackground: '#4DFFC3',
  heroText: '#00150C',
  heroTextSecondary: '#052E1D',
};
