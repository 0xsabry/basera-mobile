/**
 * UI render-smoke + structure tests for the V1.1 premium redesign.
 *
 * Screens are server-rendered (react-dom/server) inside the real
 * SettingsProvider with the default (Arabic) settings, using the
 * project's existing jest mock harness. These tests prove every screen
 * MOUNTS on the design system and renders its real, localized content
 * — they do not claim TalkBack/device behavior (device-only).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// The real package loads RN native-component internals (ESM) that the
// node harness cannot execute; the slider's behavior is device-tested.
jest.mock('@react-native-community/slider', () => ({
  __esModule: true,
  default: () => null,
}));

import AlertsScreen from '../../app/alerts';
import AssistanceScreen from '../../app/(tabs)/assistance';
import DetectScreen from '../../app/detect';
import FamilyScreen from '../../app/(tabs)/family';
import GuardianAuthScreen from '../../app/guardian-auth';
import HistoryScreen from '../../app/(tabs)/history';
import HomeScreen from '../../app/(tabs)/index';
import OnboardingScreen from '../../app/onboarding';
import PlacesScreen from '../../app/places';
import ReadScreen from '../../app/read';
import SettingsScreen from '../../app/(tabs)/settings';
import UpdatesScreen from '../../app/updates';
import VoiceScreen from '../../app/voice';
import { TAB_SCREENS } from '../../app/(tabs)/_layout';
import { t, type StringKey } from '../../i18n/strings';
import { SettingsProvider } from '../../state/SettingsContext';
import { forwardChevron } from '../../theme/glyphs';

function renderScreen(node: React.ReactNode): string {
  return renderToStaticMarkup(<SettingsProvider systemDark={false}>{node}</SettingsProvider>);
}

function expectKeys(html: string, keys: StringKey[]) {
  for (const key of keys) {
    expect(html).toContain(t('ar', key));
  }
}

describe('screen render smoke (Arabic defaults, design system)', () => {
  it('Home: brand header, hero, glasses honesty card, explore grid', () => {
    const html = renderScreen(<HomeScreen />);
    expectKeys(html, [
      'appName',
      'homeGreeting',
      'startVoiceAssistant',
      'voiceHeroState',
      'glassesCardTitle',
      'glassesCardStatus',
      'deviceStatusTitle',
      'exploreTitle',
      'detect',
      'readText',
      'places',
      'viewAlerts',
      'lastResult',
      'guardianNotConfigured',
    ]);
  });

  it('Assistance: launchers, speech controls, permissions, SOS', () => {
    const html = renderScreen(<AssistanceScreen />);
    expectKeys(html, ['startVoiceAssistant', 'repeat', 'stopSpeaking', 'permissionsTitle', 'sosButton']);
  });

  it('History: empty state + privacy note', () => {
    const html = renderScreen(<HistoryScreen />);
    expectKeys(html, ['historyEmpty', 'privacyBody']);
  });

  it('Settings: grouped sections with real controls', () => {
    const html = renderScreen(<SettingsScreen />);
    expectKeys(html, [
      'accountTitle',
      'language',
      'theme',
      'textSize',
      'voicePickerTitle',
      'permissionsTitle',
      'privacy',
      'placesProximityTitle',
      'updates',
      'about',
    ]);
  });

  it('Family (unconfigured): honest guardian note, no fake UI', () => {
    const html = renderScreen(<FamilyScreen />);
    expectKeys(html, ['guardian', 'guardianNotConfigured']);
  });

  it('Guardian auth (unconfigured): honest note only', () => {
    const html = renderScreen(<GuardianAuthScreen />);
    expectKeys(html, ['guardianNotConfigured']);
  });

  it('Onboarding: brand, glasses honesty note, language choice', () => {
    const html = renderScreen(<OnboardingScreen />);
    expectKeys(html, ['appName', 'onboardingBody', 'onboardingGlassesNote', 'onboardingPickLanguage', 'onboardingWelcome']);
  });

  it('Detect: source picker + speech actions', () => {
    const html = renderScreen(<DetectScreen />);
    expectKeys(html, ['chooseImageSource', 'sourceGallery', 'sourceGlasses', 'speak', 'stopSpeaking']);
  });

  it('Read: source picker + OCR actions', () => {
    const html = renderScreen(<ReadScreen />);
    expectKeys(html, ['chooseImageSource', 'sourceCameraTest', 'repeat']);
  });

  it('Voice: mic hero + supported commands list', () => {
    const html = renderScreen(<VoiceScreen />);
    expectKeys(html, ['tapToSpeak', 'supportedCommands', 'stopSpeaking']);
  });

  it('Places: add form + empty state', () => {
    const html = renderScreen(<PlacesScreen />);
    expectKeys(html, ['placesAddTitle', 'placesNameLabel', 'placesSaveWithLocation', 'placesEmpty']);
  });

  it('Alerts: scan note, SOS, blind spots honesty section', () => {
    const html = renderScreen(<AlertsScreen />);
    expectKeys(html, ['hazardScanNote', 'sosButton', 'alertsEmpty', 'alertsBlindSpotsTitle']);
  });

  it('Updates: status card + release notes presentation', () => {
    const html = renderScreen(<UpdatesScreen />);
    expectKeys(html, ['updates', 'updateRuntime', 'updateChannel', 'updateCheckNow']);
  });
});

describe('tab structure', () => {
  it('exactly five tabs in the established order with distinct glyphs', () => {
    expect(TAB_SCREENS.map((s) => s.name)).toEqual(['index', 'assistance', 'history', 'family', 'settings']);
    const glyphs = TAB_SCREENS.map((s) => s.glyph);
    expect(new Set(glyphs).size).toBe(5);
    for (const def of TAB_SCREENS) {
      expect(t('ar', def.titleKey).length).toBeGreaterThan(0);
      expect(t('en', def.titleKey).length).toBeGreaterThan(0);
    }
  });
});

describe('RTL helpers', () => {
  it('forward chevron flips with direction', () => {
    expect(forwardChevron(true)).toBe('‹');
    expect(forwardChevron(false)).toBe('›');
  });
});
