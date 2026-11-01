import { colorsFor, DEFAULT_SETTINGS, migrateVoicePreference, parseSettings, resolveIsDark } from '../SettingsContext';
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

describe('voice preference defaults + migration', () => {
  it('fresh installs default to the automatic (Egyptian-preferred) preference', () => {
    expect(DEFAULT_SETTINGS.voicePreference).toEqual({ kind: 'auto' });
    expect(parseSettings(null).voicePreference).toEqual({ kind: 'auto' });
    expect(parseSettings('{{').voicePreference).toEqual({ kind: 'auto' });
    expect(parseSettings('{}').voicePreference).toEqual({ kind: 'auto' });
  });

  it('legacy installs with no explicit voice (voiceIdentifier null/absent) migrate to auto', () => {
    expect(parseSettings(JSON.stringify({ voiceIdentifier: null })).voicePreference).toEqual({ kind: 'auto' });
    expect(parseSettings(JSON.stringify({ language: 'ar' })).voicePreference).toEqual({ kind: 'auto' });
  });

  it('a legacy stored voice identifier migrates to a preserved custom selection', () => {
    const s = parseSettings(JSON.stringify({ voiceIdentifier: 'eg-voice-7', speechRate: 1.3 }));
    expect(s.voicePreference).toEqual({ kind: 'custom', identifier: 'eg-voice-7' });
    // Unrelated preferences are untouched by the migration.
    expect(s.speechRate).toBe(1.3);
    expect('voiceIdentifier' in s).toBe(false);
  });

  it('an explicitly stored system preference is preserved verbatim (never re-migrated to auto)', () => {
    expect(parseSettings(JSON.stringify({ voicePreference: { kind: 'system' } })).voicePreference).toEqual({
      kind: 'system',
    });
    expect(migrateVoicePreference({ voicePreference: { kind: 'system' }, voiceIdentifier: null })).toEqual({
      kind: 'system',
    });
  });

  it('stored auto and custom preferences round-trip unchanged', () => {
    expect(parseSettings(JSON.stringify({ voicePreference: { kind: 'auto' } })).voicePreference).toEqual({
      kind: 'auto',
    });
    expect(
      parseSettings(JSON.stringify({ voicePreference: { kind: 'custom', identifier: 'v-9' } })).voicePreference,
    ).toEqual({ kind: 'custom', identifier: 'v-9' });
  });

  it('a malformed stored preference falls back safely (legacy id wins, else auto)', () => {
    expect(
      parseSettings(JSON.stringify({ voicePreference: { kind: 'custom', identifier: '  ' } })).voicePreference,
    ).toEqual({ kind: 'auto' });
    expect(
      parseSettings(
        JSON.stringify({ voicePreference: { kind: 'bogus' }, voiceIdentifier: 'legacy-1' }),
      ).voicePreference,
    ).toEqual({ kind: 'custom', identifier: 'legacy-1' });
    expect(parseSettings(JSON.stringify({ voicePreference: 'auto' })).voicePreference).toEqual({ kind: 'auto' });
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
