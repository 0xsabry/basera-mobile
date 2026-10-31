/**
 * Iconography for the V1.1 design system.
 *
 * No icon font / vector-icons package is bundled in the built APK, so
 * icons are system-font text glyphs rendered inside tinted tiles —
 * always paired with a text label (never icon-only, never color-only,
 * never emoji as a primary icon).
 */
export const GLYPHS = {
  brand: 'ب',
  home: '⌂',
  assistance: '✚',
  history: '↺',
  family: '♥',
  settings: '⚙',
  voice: '◉',
  detect: '◎',
  read: '≣',
  places: '⌖',
  alerts: '⚠',
  sos: '✚',
  updates: '↻',
  check: '✓',
  error: '✕',
  info: 'ℹ',
  glasses: '◌',
  camera: '◎',
  gallery: '▤',
  sample: '▦',
  mic: '◉',
  location: '⌖',
  notifications: '✦',
  repeat: '↺',
  stop: '■',
  speak: '▶',
  star: '★',
  empty: '◌',
  shield: '⬢',
  account: '●',
  privacy: '⬢',
  language: '≣',
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** Per-category glyphs for Smart Place Memory (keys = PlaceCategory). */
export const PLACE_CATEGORY_GLYPHS: Record<string, string> = {
  home: '⌂',
  university: '▤',
  work: '▥',
  family: '♥',
  hospital: '✚',
  pharmacy: '⊕',
  shop: '▩',
  mosque: '☪',
  transport: '➤',
  custom: '●',
};

/** Chevron that points "forward" for the given layout direction. */
export function forwardChevron(isRTL: boolean): string {
  return isRTL ? '‹' : '›';
}
