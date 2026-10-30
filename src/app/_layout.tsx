import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SettingsProvider, useSettings } from '../state/SettingsContext';
import { getLocationSharingService } from '../guardian/LocationSharingService';
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
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
      {/* Main tab navigation (Home / Assistance / History / Family / Settings) */}
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ title: t(lang, 'onboardingTitle'), ...header }} />
      <Stack.Screen name="detect" options={{ title: t(lang, 'detect'), ...header }} />
      <Stack.Screen name="read" options={{ title: t(lang, 'readText'), ...header }} />
      <Stack.Screen name="voice" options={{ title: t(lang, 'voice'), ...header }} />
      <Stack.Screen name="guardian-auth" options={{ title: t(lang, 'guardianOpenSignIn'), ...header }} />
      <Stack.Screen name="updates" options={{ title: t(lang, 'updates'), ...header }} />
      <Stack.Screen name="places" options={{ title: t(lang, 'places'), ...header }} />
      <Stack.Screen name="alerts" options={{ title: t(lang, 'alertsTitle'), ...header }} />
    </Stack>
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
