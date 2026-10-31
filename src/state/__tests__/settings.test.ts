import { colorsFor, DEFAULT_SETTINGS, parseSettings, resolveIsDark } from '../SettingsContext';
import { darkColors, darkHighContrast, lightColors } from '../../theme/tokens';

describe('settings persistence parsing', () => {
  it('returns defaults for null/corrupt input', () => {
    expect(parseSettings(null).language).toBe('ar');
    expect(parseSettings('{{').speechRate).toBe(1.0);
  });
  it('fresh install (no stored preference) defaults to the LIGHT theme', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('light');
    expect(parseSettings(null).theme).toBe('light');
    expect(parseSettings('{{').theme).toBe('light');
    // …even when the OS itself is in dark mode: with no stored choice
    // the resolved theme is light (the 'system' fallback no longer
    // applies to users who never chose).
    expect(resolveIsDark(parseSettings(null).theme, true)).toBe(false);
  });
  it('a stored theme preference always wins over the default', () => {
    expect(parseSettings(JSON.stringify({ theme: 'dark' })).theme).toBe('dark');
    expect(parseSettings(JSON.stringify({ theme: 'system' })).theme).toBe('system');
    expect(resolveIsDark(parseSettings(JSON.stringify({ theme: 'dark' })).theme, false)).toBe(true);
  });
  it('merges stored values over defaults', () => {
    const s = parseSettings(JSON.stringify({ language: 'en', theme: 'dark', onboardingDone: true }));
    expect(s.language).toBe('en');
    expect(s.theme).toBe('dark');
    expect(s.onboardingDone).toBe(true);
    expect(s.highContrast).toBe(false);
  });
});

describe('theme resolution', () => {
  it('resolves dark/light/system', () => {
    expect(resolveIsDark('dark', false)).toBe(true);
    expect(resolveIsDark('light', true)).toBe(false);
    expect(resolveIsDark('system', true)).toBe(true);
    expect(resolveIsDark('system', false)).toBe(false);
  });
  it('high contrast swaps palettes', () => {
    expect(colorsFor(false, false)).toBe(lightColors);
    expect(colorsFor(true, false)).toBe(darkColors);
    expect(colorsFor(true, true)).toBe(darkHighContrast);
  });
});
