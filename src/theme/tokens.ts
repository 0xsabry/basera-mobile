/** BASERA design tokens — accessibility first. */
export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 };
export const radius = { sm: 10, md: 14, lg: 20 };
/** Minimum touch target: 60dp (above the 48dp platform minimum). */
export const MIN_TOUCH = 60;
export const BUTTON_HEIGHT = 64;

export const typeScale = {
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
  accent: string;
  danger: string;
  /** Semantic status colors — always paired with text, never color alone. */
  success: string;
  warning: string;
  info: string;
  border: string;
  overlayBox: string;
}

export const lightColors: ThemeColors = {
  background: '#FFFFFF',
  surface: '#F2F5F3',
  surfaceAlt: '#E4EBE7',
  text: '#0A1F16',
  textSecondary: '#3D5247',
  primary: '#0B6B4F',
  primaryText: '#FFFFFF',
  accent: '#8A5A00',
  danger: '#B3261E',
  success: '#146C2E',
  warning: '#8A5A00',
  info: '#0B5394',
  border: '#5A7264',
  overlayBox: '#0B6B4F',
};

export const darkColors: ThemeColors = {
  background: '#0A120E',
  surface: '#16211B',
  surfaceAlt: '#1F2E25',
  text: '#F2F7F4',
  textSecondary: '#B9CFC2',
  primary: '#2FBF8F',
  primaryText: '#04150D',
  accent: '#FFC44D',
  danger: '#FF8A80',
  success: '#4CC38A',
  warning: '#FFC44D',
  info: '#6CB2F5',
  border: '#4A6A58',
  overlayBox: '#2FBF8F',
};

/** High-contrast variants push text/background to extremes. */
export const lightHighContrast: ThemeColors = {
  ...lightColors,
  text: '#000000',
  textSecondary: '#1A1A1A',
  border: '#000000',
  primary: '#004D33',
  success: '#00511F',
  warning: '#5C3A00',
  info: '#003B73',
  danger: '#8F130C',
};

export const darkHighContrast: ThemeColors = {
  ...darkColors,
  background: '#000000',
  surface: '#0D0D0D',
  text: '#FFFFFF',
  textSecondary: '#FFFFFF',
  border: '#FFFFFF',
  primary: '#4DFFC3',
  success: '#00FF9D',
  warning: '#FFE14D',
  info: '#66CCFF',
  danger: '#FF6D60',
};
