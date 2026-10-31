import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager } from 'react-native';
import { speechService } from '../ai/SpeechService';
import type { AppLanguage } from '../ai/types';
import { t } from '../i18n/strings';
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
import { isAccessibilityBusy, subscribeAccessibilityBusy } from './accessibilityBusy';
import { setHapticsEnabled } from './haptics';
import { LanguageRestartCoordinator, needsDirectionRestart } from './languageRestart';

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
  /**
   * Switch the UI language. Persists like update(), applies the layout
   * direction, and — when the direction flips (ar↔en) — restarts the app
   * through the guarded language-restart coordinator, because React
   * Native only applies a forced RTL change on reload.
   */
  switchLanguage: (lang: AppLanguage) => Promise<void>;
  /**
   * True when a direction-flipping language change was persisted but the
   * native updates module cannot reload in this build (Expo Go / dev):
   * the new language applies on the next manual restart. Never set when
   * a reload happened or was deferred behind a busy operation.
   */
  languageRestartPendingManual: boolean;
  loaded: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  colors: lightColors,
  type: scaledType(1),
  isDark: false,
  update: async () => undefined,
  switchLanguage: async () => undefined,
  languageRestartPendingManual: false,
  loaded: false,
});

/* ------------------------------------------------------------------ */
/* Language-restart wiring (Bug 2). The native expo-updates module is  */
/* lazy-required with the same availability style as UpdateService:    */
/* a language restart is NOT an update apply, so it must not go        */
/* through UpdateService.restartToApply (which requires a pending      */
/* update) — it only needs reloadAsync + the module being enabled.     */
/* ------------------------------------------------------------------ */

interface UpdatesModuleShape {
  isEnabled?: boolean;
  reloadAsync?: () => Promise<void>;
}

function loadUpdatesModule(): UpdatesModuleShape | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-updates') as UpdatesModuleShape;
    if (!mod || typeof mod.reloadAsync !== 'function') return null;
    return mod;
  } catch {
    return null;
  }
}

function canReloadApp(): boolean {
  const mod = loadUpdatesModule();
  return !!mod && mod.isEnabled === true;
}

async function reloadApp(): Promise<void> {
  const mod = loadUpdatesModule();
  if (!mod || typeof mod.reloadAsync !== 'function') {
    throw new Error('expo-updates reloadAsync unavailable in this build');
  }
  await mod.reloadAsync();
}

/** Language the pending restart announcement must be spoken in. */
let restartAnnounceLang: AppLanguage = 'ar';
let sharedRestartCoordinator: LanguageRestartCoordinator | null = null;

function getLanguageRestartCoordinator(): LanguageRestartCoordinator {
  if (!sharedRestartCoordinator) {
    sharedRestartCoordinator = new LanguageRestartCoordinator({
      isBusy: isAccessibilityBusy,
      subscribeBusy: subscribeAccessibilityBusy,
      canReload: canReloadApp,
      reload: reloadApp,
      announce: (text) => {
        void speechService.speakAnnouncement(text, restartAnnounceLang).catch(() => undefined);
      },
    });
  }
  return sharedRestartCoordinator;
}

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
  const [languageRestartPendingManual, setLanguageRestartPendingManual] = useState(false);

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

  // Stable identity (bug-fix release): consumers legitimately depend on
  // `update` in hook dependency arrays; it only uses stable setters.
  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      if (patch.language) applyLayoutDirection(patch.language);
      return next;
    });
  }, []);

  const switchLanguage = async (lang: AppLanguage) => {
    const prevLang = settings.language;
    await update({ language: lang });
    applyLayoutDirection(lang);
    if (!needsDirectionRestart(prevLang, lang)) return;
    restartAnnounceLang = lang;
    const status = getLanguageRestartCoordinator().requestLanguageChange(
      t(lang, 'languageRestartNotice'),
      t(lang, 'languageRestartDeferred'),
    );
    if (status === 'unavailable') {
      // Dev / Expo Go: reloadAsync cannot run here. The language and the
      // direction flag are already persisted, so they apply on the next
      // cold start — surface that honestly instead of silently leaving
      // the mixed-direction UI unexplained.
      setLanguageRestartPendingManual(true);
    }
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
      switchLanguage,
      languageRestartPendingManual,
      loaded,
    };
    // switchLanguage closes over the current settings.language; the memo
    // re-runs whenever settings change, so the closure stays current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, systemDark, loaded, languageRestartPendingManual]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}
