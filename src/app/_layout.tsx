import { Stack } from 'expo-router';
import React, { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SettingsProvider, useSettings } from '../state/SettingsContext';
import { getLocationSharingService } from '../guardian/LocationSharingService';
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
  const header = {
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.text,
    headerTitleStyle: { fontWeight: '700' as const },
  };
  return (
    <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ title: t(lang, 'appName'), ...header }} />
      <Stack.Screen name="onboarding" options={{ title: t(lang, 'onboardingTitle'), ...header }} />
      <Stack.Screen name="detect" options={{ title: t(lang, 'detect'), ...header }} />
      <Stack.Screen name="read" options={{ title: t(lang, 'readText'), ...header }} />
      <Stack.Screen name="voice" options={{ title: t(lang, 'voice'), ...header }} />
      <Stack.Screen name="history" options={{ title: t(lang, 'history'), ...header }} />
      <Stack.Screen name="guardian" options={{ title: t(lang, 'guardian'), ...header }} />
      <Stack.Screen name="guardian-auth" options={{ title: t(lang, 'guardianOpenSignIn'), ...header }} />
      <Stack.Screen name="updates" options={{ title: t(lang, 'updates'), ...header }} />
      <Stack.Screen name="settings" options={{ title: t(lang, 'settings'), ...header }} />
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
