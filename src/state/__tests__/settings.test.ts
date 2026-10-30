import { colorsFor, parseSettings, resolveIsDark } from '../SettingsContext';
import { darkColors, darkHighContrast, lightColors } from '../../theme/tokens';

describe('settings persistence parsing', () => {
  it('returns defaults for null/corrupt input', () => {
    expect(parseSettings(null).language).toBe('ar');
    expect(parseSettings('{{').speechRate).toBe(1.0);
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
