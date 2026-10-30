import { Stack } from 'expo-router';
import React from 'react';
import { useColorScheme } from 'react-native';
import { SettingsProvider, useSettings } from '../state/SettingsContext';
import { t } from '../i18n/strings';

function RootStack() {
  const { settings, colors } = useSettings();
  const lang = settings.language;
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
