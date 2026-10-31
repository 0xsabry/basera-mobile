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
   * Bottom tab bar tints (Bug 5; state separation reworked v1.1.2;
   * brand-aligned v1.1.3). Dedicated tokens, NOT aliases of
   * primary/textSecondary: the tab glyphs are thin outline forms
   * (♡ ⌂) whose ~1px strokes wash out on device even when the raw
   * color ratio passes AA, so both tints are held to ≥ 9:1 against
   * `surface` (the bar background) in every palette — verified in
   * contrast.test.ts. State separation does NOT rely on these tints
   * alone: the ACTIVE tint is the brand navy/bright-blue, the
   * INACTIVE tint is a neutral slate, and since v1.1.3 the active
   * glyph sits inside a soft filled container (tabActiveContainer,
   * glyph-on-container also locked ≥ 9:1) with 800/600 weights on
   * top — hue family + shape + weight, never one cue.
   */
  tabActive: string;
  tabInactive: string;
  /** Soft fill behind the ACTIVE tab glyph's rounded container. */
  tabActiveContainer: string;
  accent: string;
  danger: string;
  /**
   * Text on a filled `danger` surface (the SOS button). NOT always
   * white: in the dark palettes `danger` is a light salmon, where
   * white text measured 2.28:1 — the pair is locked ≥ 4.5:1 in
   * contrast.test.ts (v1.1.2 fix).
   */
  dangerText: string;
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

/**
 * v1.1.3 brand alignment (docs/BRAND_COLORS_1.1.3.md): all four
 * palettes rebuilt on the OFFICIAL logo identity — deep navy /
 * royal blue / bright blue / gold — replacing the olive-green
 * system. Anchors from the owner's spec: primary navy #071B49,
 * deep navy #061434, royal #1559C9, bright #1685F8, soft #EAF3FF,
 * gold #F2B632, light bg #F5F8FD, text #14213D, secondary #64748B.
 * Where a spec value fails a locked contrast floor it is adjusted
 * minimally and documented with its measured ratio (accent in the
 * light palette is a darkened bronze-gold: raw #F2B632 measures
 * ~1.9:1 as text on white; the dark palettes carry the raw gold).
 */
export const lightColors: ThemeColors = {
  background: '#F5F8FD',
  surface: '#FFFFFF',
  surfaceAlt: '#E3EEFD',
  text: '#14213D',
  textSecondary: '#51637C',
  primary: '#1559C9',
  primaryText: '#FFFFFF',
  tabActive: '#0A2F73',
  tabInactive: '#323C48',
  tabActiveContainer: '#EAF3FF',
  accent: '#7A5800',
  danger: '#B3261E',
  dangerText: '#FFFFFF',
  success: '#137547',
  warning: '#9A4A00',
  info: '#1559C9',
  border: '#71809A',
  overlayBox: '#1559C9',
  primarySoft: '#EAF3FF',
  onPrimarySoft: '#0A3A8C',
  dangerSoft: '#F9DEDC',
  onDangerSoft: '#7A1A14',
  successSoft: '#D9EBDF',
  onSuccessSoft: '#0B4A26',
  warningSoft: '#FBEEDB',
  onWarningSoft: '#7A3E00',
  infoSoft: '#DCE9FD',
  onInfoSoft: '#0B3D91',
  heroBackground: '#071B49',
  heroText: '#FFFFFF',
  heroTextSecondary: '#B9D2F5',
  shadow: 'rgba(7, 27, 73, 0.16)',
};

export const darkColors: ThemeColors = {
  background: '#061434',
  surface: '#0A1F44',
  surfaceAlt: '#12295A',
  text: '#F2F7FF',
  textSecondary: '#A9BBD6',
  primary: '#4E9DF0',
  primaryText: '#041633',
  tabActive: '#BAD4FF',
  tabInactive: '#D3DCE8',
  tabActiveContainer: '#122954',
  accent: '#F2B632',
  danger: '#FF8A80',
  dangerText: '#2B0703',
  success: '#40C48E',
  warning: '#FF9E57',
  info: '#6FA8FF',
  border: '#3A5A8C',
  overlayBox: '#1685F8',
  primarySoft: '#12294F',
  onPrimarySoft: '#A9CCFF',
  dangerSoft: '#3D1A16',
  onDangerSoft: '#FFB4A8',
  successSoft: '#0E2E22',
  onSuccessSoft: '#7FE0A8',
  warningSoft: '#38260E',
  onWarningSoft: '#FFC98A',
  infoSoft: '#10294D',
  onInfoSoft: '#9CC2FF',
  heroBackground: '#1559C9',
  heroText: '#FFFFFF',
  heroTextSecondary: '#D6E6FD',
  shadow: 'rgba(0, 0, 0, 0.5)',
};

/** High-contrast variants push text/background to extremes. */
export const lightHighContrast: ThemeColors = {
  ...lightColors,
  text: '#000000',
  textSecondary: '#1A1A1A',
  border: '#000000',
  primary: '#0A3A8C',
  tabActive: '#08306B',
  tabInactive: '#000000',
  success: '#00511F',
  warning: '#7A3400',
  info: '#06377A',
  danger: '#8F130C',
  accent: '#5C3F00',
  primarySoft: '#FFFFFF',
  onPrimarySoft: '#0A3A8C',
  dangerSoft: '#FFFFFF',
  onDangerSoft: '#8F130C',
  successSoft: '#FFFFFF',
  onSuccessSoft: '#00511F',
  warningSoft: '#FFFFFF',
  onWarningSoft: '#7A3400',
  infoSoft: '#FFFFFF',
  onInfoSoft: '#06377A',
  heroBackground: '#071B49',
  heroText: '#FFFFFF',
  heroTextSecondary: '#D6E6FD',
};

export const darkHighContrast: ThemeColors = {
  ...darkColors,
  background: '#000000',
  surface: '#0A1428',
  surfaceAlt: '#14213D',
  text: '#FFFFFF',
  textSecondary: '#FFFFFF',
  border: '#FFFFFF',
  primary: '#7FB8FF',
  primaryText: '#04122B',
  tabActive: '#A9D1FF',
  tabInactive: '#FFFFFF',
  tabActiveContainer: '#0E2148',
  success: '#00FF9D',
  warning: '#FFB26B',
  info: '#7FC4FF',
  danger: '#FF6D60',
  accent: '#FFE14D',
  overlayBox: '#7FC4FF',
  primarySoft: '#0A1428',
  onPrimarySoft: '#8FC2FF',
  dangerSoft: '#0A1428',
  onDangerSoft: '#FF8A75',
  successSoft: '#0A1428',
  onSuccessSoft: '#00FF9D',
  warningSoft: '#0A1428',
  onWarningSoft: '#FFB26B',
  infoSoft: '#0A1428',
  onInfoSoft: '#7FC4FF',
  heroBackground: '#7FB8FF',
  heroText: '#04122B',
  heroTextSecondary: '#0A2E6E',
};
