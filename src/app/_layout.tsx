import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { ThemedStatusBar } from '../components/ThemedStatusBar';
import { SettingsProvider, useSettings } from '../state/SettingsContext';
import { updateService } from '../update/UpdateService';
import { getLocationSharingService } from '../guardian/LocationSharingService';
import '../guardian/backgroundTask';
import { configureHazardRuntime } from '../hazards/HazardService';
import { t } from '../i18n/strings';

function RootStack() {
  const { settings, colors } = useSettings();
  const lang = settings.language;

  // App-launch retry trigger for a persisted server-deletion obligation
  // (offline revocation): if the user turned sharing off / revoked the
  // last guardian while offline, the purge is retried here until the
  // server confirms. No-op when nothing is pending.
  useEffect(() => {
    void getLocationSharingService().initDeletion();
  }, []);

  // Launch update check (owner/team update from inside the app from
  // now on): every cold start checks for a compatible OTA and downloads
  // it in the background. Per the UpdateService safety contract this
  // NEVER reloads and never interrupts speech/camera/OCR/hazard work —
  // a downloaded update applies on the next natural cold start, or
  // immediately only via the guarded "Restart to apply" on the Updates
  // screen, whose state (and the Settings updates row) reflects the
  // result through the service subscription. Before this effect the
  // only check in the app was the manual button on the Updates screen.
  useEffect(() => {
    void updateService.checkAndDownload();
  }, []);

  // Hazard events may attach location server-side ONLY while sharing is
  // on — the hazard runtime reads the live consent value through here.
  const sharingOn = settings.guardianSharingEnabled || settings.backgroundSharingEnabled;
  useEffect(() => {
    configureHazardRuntime({ isSharingOn: () => sharingOn });
  }, [sharingOn]);
  const header = {
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerTitleStyle: { fontWeight: '700' as const },
  };
  return (
    <>
      {/* Status-bar icons follow the resolved theme (dark icons on the
          light theme, light icons on dark) — without this the battery /
          clock vanish on the ivory background. Renders inside the
          SettingsProvider tree, so it reacts to theme changes live. */}
      <ThemedStatusBar />
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
      {/* Main tab navigation (Home / Assistance / History / Family / Settings) */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ title: t(lang, 'onboardingTitle'), ...header }} />
      <Stack.Screen name="detect" options={{ title: t(lang, 'detect'), ...header }} />
      <Stack.Screen name="read" options={{ title: t(lang, 'readText'), ...header }} />
      <Stack.Screen name="voice" options={{ title: t(lang, 'voiceAssistance'), ...header }} />
      <Stack.Screen name="guardian-auth" options={{ title: t(lang, 'guardianOpenSignIn'), ...header }} />
      <Stack.Screen name="updates" options={{ title: t(lang, 'updates'), ...header }} />
      <Stack.Screen name="settings-voice" options={{ title: t(lang, 'voicePickerTitle'), ...header }} />
      <Stack.Screen name="places" options={{ title: t(lang, 'places'), ...header }} />
      <Stack.Screen name="alerts" options={{ title: t(lang, 'alertsTitle'), ...header }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SettingsProvider systemDark={scheme === 'dark'}>
      <RootStack />
    </SettingsProvider>
  );
}
