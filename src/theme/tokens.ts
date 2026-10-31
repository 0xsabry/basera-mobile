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
   * container added v1.1.3; olive identity v1.1.4). Dedicated
   * tokens, NOT aliases of primary/textSecondary: the tab glyphs
   * are thin outline forms (♡ ⌂) whose ~1px strokes wash out on
   * device even when the raw color ratio passes AA, so both tints
   * are held to ≥ 9:1 against `surface` (the bar background) in
   * every palette — verified in contrast.test.ts. State separation
   * does NOT rely on these tints alone: the active glyph sits
   * inside a filled container (tabActiveContainer, glyph-on-
   * container also locked ≥ 9:1) with 800/600 weights and the
   * label on top — shape + weight + tint, never one cue.
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
 * v1.1.4 visual identity (docs/IDENTITY_OLIVE_1.1.4.md): all four
 * palettes rebuilt on the owner's olive / sage / ivory system,
 * replacing the v1.1.3 navy/royal identity (owner-rejected). The
 * official logo artwork is unchanged — the interface complements
 * it instead of copying its blues. Owner anchors: deep olive
 * #26372D, primary olive #657A4D, soft olive #788A5B, light sage
 * #C7D5B8, warm ivory #F5F3EA, white, text #263229, secondary
 * #687267. Two documented adjustments (measured, in the doc):
 * light textSecondary #687267 → #5C665C (owner value is 4.09:1 on
 * surfaceAlt; adjusted 4.88:1) and dark tabActive = the owner sage
 * lightened one step (#C7D5B8 → #D8E4CB) so glyph-on-container
 * reaches 9.53:1. No blue remains in any palette; the only gold is
 * the `accent` token (bronze in light palettes, where raw #F2B632
 * measures ~1.9:1 as text; raw gold in the dark palettes).
 */
export const lightColors: ThemeColors = {
  background: '#F5F3EA',
  surface: '#FFFFFF',
  surfaceAlt: '#E6EAD9',
  text: '#263229',
  textSecondary: '#5C665C',
  primary: '#657A4D',
  primaryText: '#FFFFFF',
  tabActive: '#26372D',
  tabInactive: '#3D443C',
  tabActiveContainer: '#E9EFE0',
  accent: '#7A5800',
  danger: '#B3261E',
  dangerText: '#FFFFFF',
  success: '#1E6B34',
  warning: '#9A4A00',
  info: '#3D5C43',
  border: '#7E8A76',
  overlayBox: '#657A4D',
  primarySoft: '#E9EFE0',
  onPrimarySoft: '#2E4429',
  dangerSoft: '#F9DEDC',
  onDangerSoft: '#7A1A14',
  successSoft: '#DFEDD8',
  onSuccessSoft: '#174D24',
  warningSoft: '#FBEEDB',
  onWarningSoft: '#7A3E00',
  infoSoft: '#E6EAD9',
  onInfoSoft: '#2C4430',
  heroBackground: '#26372D',
  heroText: '#FFFFFF',
  heroTextSecondary: '#C7D5B8',
  shadow: 'rgba(38, 55, 45, 0.16)',
};

export const darkColors: ThemeColors = {
  background: '#131A15',
  surface: '#1D2820',
  surfaceAlt: '#28362B',
  text: '#F1F2E7',
  textSecondary: '#ACBAA2',
  primary: '#9DB47E',
  primaryText: '#17220F',
  tabActive: '#D8E4CB',
  tabInactive: '#D3DCC6',
  tabActiveContainer: '#26372D',
  accent: '#F2B632',
  danger: '#FF8A80',
  dangerText: '#2B0703',
  success: '#4CC47E',
  warning: '#FF9E57',
  info: '#A9C29B',
  border: '#4A5A46',
  overlayBox: '#B7CBA3',
  primarySoft: '#22301F',
  onPrimarySoft: '#C4D8AB',
  dangerSoft: '#3D1A16',
  onDangerSoft: '#FFB4A8',
  successSoft: '#142A1A',
  onSuccessSoft: '#8FE0A8',
  warningSoft: '#38260E',
  onWarningSoft: '#FFC98A',
  infoSoft: '#1E2E22',
  onInfoSoft: '#BCDBAC',
  heroBackground: '#2E4034',
  heroText: '#FFFFFF',
  heroTextSecondary: '#C7D5B8',
  shadow: 'rgba(0, 0, 0, 0.5)',
};

/** High-contrast variants push text/background to extremes. */
export const lightHighContrast: ThemeColors = {
  ...lightColors,
  text: '#000000',
  textSecondary: '#1A1A1A',
  border: '#000000',
  primary: '#3E5228',
  tabActive: '#1E2E20',
  tabInactive: '#000000',
  tabActiveContainer: '#DCE5CF',
  success: '#00511F',
  warning: '#7A3400',
  info: '#243B26',
  danger: '#8F130C',
  accent: '#5C3F00',
  primarySoft: '#FFFFFF',
  onPrimarySoft: '#3E5228',
  dangerSoft: '#FFFFFF',
  onDangerSoft: '#8F130C',
  successSoft: '#FFFFFF',
  onSuccessSoft: '#00511F',
  warningSoft: '#FFFFFF',
  onWarningSoft: '#7A3400',
  infoSoft: '#FFFFFF',
  onInfoSoft: '#243B26',
  heroBackground: '#26372D',
  heroText: '#FFFFFF',
  heroTextSecondary: '#E4EDD6',
};

export const darkHighContrast: ThemeColors = {
  ...darkColors,
  background: '#000000',
  surface: '#0C120D',
  surfaceAlt: '#1A241C',
  text: '#FFFFFF',
  textSecondary: '#FFFFFF',
  border: '#FFFFFF',
  primary: '#B9D69A',
  primaryText: '#0E1A0A',
  tabActive: '#D6E5C3',
  tabInactive: '#FFFFFF',
  tabActiveContainer: '#22331F',
  success: '#00FF9D',
  warning: '#FFB26B',
  info: '#CFE3B8',
  danger: '#FF6D60',
  accent: '#FFE14D',
  overlayBox: '#CFE3B8',
  primarySoft: '#0C120D',
  onPrimarySoft: '#CDEBB2',
  dangerSoft: '#0C120D',
  onDangerSoft: '#FF8A75',
  successSoft: '#0C120D',
  onSuccessSoft: '#00FF9D',
  warningSoft: '#0C120D',
  onWarningSoft: '#FFB26B',
  infoSoft: '#0C120D',
  onInfoSoft: '#CFE3B8',
  heroBackground: '#B9D69A',
  heroText: '#101C0A',
  heroTextSecondary: '#22331A',
};
