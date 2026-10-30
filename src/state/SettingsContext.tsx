import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';
import { speechService } from '../ai/SpeechService';
import type { AppLanguage } from '../ai/types';
import {
  darkColors,
  darkHighContrast,
  lightColors,
  lightHighContrast,
  scaledType,
  type TextScaleOption,
  type ThemeColors,
  type TypeScale,
} from '../theme/tokens';
import { setHapticsEnabled } from './haptics';

export type ThemePreference = 'light' | 'dark' | 'system';

export interface Settings {
  language: AppLanguage;
  theme: ThemePreference;
  speechRate: number; // 0.5 .. 2.0
  highContrast: boolean;
  announcements: boolean;
  onboardingDone: boolean;
  /** V1.1 Phase 1: guardian location sharing consent (default OFF). The
   *  server record (device_settings) mirrors this; the phone is the source
   *  of truth and turning it off purges stored locations server-side. */
  guardianSharingEnabled: boolean;
  /** V1.1 Phase 2: background tracking consent (default OFF). Separate
   *  from foreground consent: requires its own explanation + the Android
   *  background-location permission before anything starts. */
  backgroundSharingEnabled: boolean;
  /** Larger-text scale multiplier applied to the type scale. */
  textScale: TextScaleOption;
  /** Reduced motion: disables press/transition effects. */
  reducedMotion: boolean;
  /** Master speech-output gate (Settings → Voice). Off = no TTS at all. */
  speechEnabled: boolean;
  /** Chosen TTS voice identifier (null = OS default for the language). */
  voiceIdentifier: string | null;
  /** Vibration alerts gate (hazard alerts + key confirmations). */
  hapticsEnabled: boolean;
  /** Smart Place Memory proximity radius in meters. */
  proximityRadiusM: number;
  /** Saved-places cloud sync opt-in (only meaningful when Supabase is
   *  configured; default OFF — places are local unless the user opts in). */
  placesSyncEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'ar',
  theme: 'system',
  speechRate: 1.0,
  highContrast: false,
  announcements: true,
  onboardingDone: false,
  guardianSharingEnabled: false,
  backgroundSharingEnabled: false,
  textScale: 1,
  reducedMotion: false,
  speechEnabled: true,
  voiceIdentifier: null,
  hapticsEnabled: true,
  proximityRadiusM: 150,
  placesSyncEnabled: false,
};

const STORAGE_KEY = 'basera.settings.v1';

export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Apply RTL/LTR for the chosen language. Requires reload to fully flip on
 *  native, so the app also mirrors layouts via flexDirection where needed. */
export function applyLayoutDirection(lang: AppLanguage): void {
  const shouldBeRTL = lang === 'ar';
  try {
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.forceRTL(shouldBeRTL);
    }
  } catch {
    // Web / test environments may not implement I18nManager fully.
  }
}

interface SettingsContextValue {
  settings: Settings;
  colors: ThemeColors;
  /** Type scale with the user's larger-text preference applied. */
  type: TypeScale;
  isDark: boolean;
  update: (patch: Partial<Settings>) => Promise<void>;
  loaded: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  colors: lightColors,
  type: scaledType(1),
  isDark: false,
  update: async () => undefined,
  loaded: false,
});

export function resolveIsDark(pref: ThemePreference, systemDark: boolean): boolean {
  if (pref === 'dark') return true;
  if (pref === 'light') return false;
  return systemDark;
}

export function colorsFor(isDark: boolean, highContrast: boolean): ThemeColors {
  if (isDark) return highContrast ? darkHighContrast : darkColors;
  return highContrast ? lightHighContrast : lightColors;
}

export function SettingsProvider({
  children,
  systemDark,
}: {
  children: React.ReactNode;
  systemDark: boolean;
}) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        const s = parseSettings(raw);
        setSettings(s);
        applyLayoutDirection(s.language);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const update = async (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      if (patch.language) applyLayoutDirection(patch.language);
      return next;
    });
  };

  // Keep the non-React services in sync with the persisted preferences:
  // speech gate + chosen voice + rate, and the vibration gate.
  useEffect(() => {
    speechService.setSpeechEnabled(settings.speechEnabled);
    speechService.setVoiceIdentifier(settings.voiceIdentifier);
    speechService.setRate(settings.speechRate);
    setHapticsEnabled(settings.hapticsEnabled);
  }, [settings.speechEnabled, settings.voiceIdentifier, settings.speechRate, settings.hapticsEnabled]);

  const value = useMemo<SettingsContextValue>(() => {
    const isDark = resolveIsDark(settings.theme, systemDark);
    return {
      settings,
      colors: colorsFor(isDark, settings.highContrast),
      type: scaledType(settings.textScale),
      isDark,
      update,
      loaded,
    };
  }, [settings, systemDark, loaded]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
