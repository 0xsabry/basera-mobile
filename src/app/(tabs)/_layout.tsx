/**
 * Main bottom navigation — five destinations, always reachable:
 * Home, Assistance, History, Family, Settings.
 *
 * Accessibility contract: every tab is a ≥64dp touch target with a text
 * label (never icon-only), an explicit screen-reader label, and clear
 * active/inactive states (color + bold label, not color alone). The bar
 * respects the device safe area and never overlaps screen content —
 * tab screens render above it in the normal layout flow.
 *
 * Sub-screens (detect, read, voice, updates, guardian-auth, places,
 * alerts, onboarding) are stack routes in the root layout, pushed above
 * the tabs, so the tab bar never covers their controls.
 */
import { Tabs } from 'expo-router';
import React from 'react';
import { Text, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t, type StringKey } from '../../i18n/strings';
import { useSettings } from '../../state/SettingsContext';

const TAB_ICON_SIZE = 26;

function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }) {
  return (
    <Text style={{ fontSize: TAB_ICON_SIZE, lineHeight: TAB_ICON_SIZE + 6, color }} accessibilityElementsHidden>
      {glyph}
    </Text>
  );
}

export default function TabsLayout() {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;
  const insets = useSafeAreaInsets();

  const tab = (titleKey: StringKey, glyph: string) => ({
    title: t(lang, titleKey),
    tabBarAccessibilityLabel: t(lang, titleKey),
    tabBarIcon: ({ color }: { color: ColorValue }) => <TabGlyph glyph={glyph} color={color} />,
  });

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1.5,
          height: 68 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarItemStyle: { minHeight: 56 },
        tabBarLabelStyle: { fontSize: type.caption, fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ ...tab('home', '⌂'), title: t(lang, 'appName') }} />
      <Tabs.Screen name="assistance" options={tab('assistance', '✚')} />
      <Tabs.Screen name="history" options={tab('history', '↺')} />
      <Tabs.Screen name="family" options={tab('family', '♥')} />
      <Tabs.Screen name="settings" options={tab('settings', '⚙')} />
    </Tabs>
  );
}
