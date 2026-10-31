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

  // Launch update flow (owner order: updates must need ZERO user
  // steps): every cold start checks for a compatible OTA, downloads
  // it, and — if one is staged — applies it immediately through the
  // service's guarded apply path. Cold start is the safe moment: no
  // speech/camera/OCR/hazard operation can be in flight yet, and the
  // apply path's busy guard still refuses if one somehow is. The
  // outcome (ready / up-to-date / error with the real reason)
  // is visible on the Updates screen and the Settings updates row via
  // the service subscription. Before the 1.1.5 round the only check
  // was a manual button; before this round a download still waited
  // for a further restart or a manual apply.
  useEffect(() => {
    void updateService.checkAndApplyOnLaunch();
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
