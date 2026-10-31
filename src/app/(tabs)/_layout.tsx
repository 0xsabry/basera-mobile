/**
 * Main bottom navigation — five destinations, always reachable:
 * Home, Assistance, History, Family, Settings.
 *
 * V1.1 premium redesign: the active tab is marked by accent glyph
 * color + bold label (no filled pill background — the bar stays
 * quiet) under a top hairline — never by color alone. Accessibility
 * contract unchanged: every tab is a ≥64dp touch target with a text
 * label (never icon-only), an explicit screen-reader label, and the
 * bar respects the device safe area.
 *
 * Sub-screens (detect, read, voice, updates, guardian-auth, places,
 * alerts, onboarding) are stack routes in the root layout, pushed above
 * the tabs, so the tab bar never covers their controls.
 */
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t, type StringKey } from '../../i18n/strings';
import { useSettings } from '../../state/SettingsContext';
import { GLYPHS } from '../../theme/glyphs';

export interface TabScreenDef {
  name: string;
  titleKey: StringKey;
  glyph: string;
}

/** The five tabs, in bar order. Exported for structure tests. */
export const TAB_SCREENS: TabScreenDef[] = [
  { name: 'index', titleKey: 'home', glyph: GLYPHS.home },
  { name: 'assistance', titleKey: 'assistance', glyph: GLYPHS.assistance },
  { name: 'history', titleKey: 'history', glyph: GLYPHS.history },
  { name: 'family', titleKey: 'family', glyph: GLYPHS.family },
  { name: 'settings', titleKey: 'settings', glyph: GLYPHS.settings },
];

const TAB_ICON_SIZE = 24;

function TabGlyph({ glyph, color, focused }: { glyph: string; color: ColorValue; focused: boolean }) {
  return (
    <View
      style={{
        backgroundColor: 'transparent',
        paddingHorizontal: 14,
        paddingVertical: 3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        // Bug 5: inactive weight 400 -> 600. The tab glyphs are thin
        // outline forms (◇ ♡ ⌂); at 400 their ~1px strokes rendered
        // barely visible on device even in a passing color. 600 gives
        // the stroke real presence at the same 24dp size — no filled
        // blocks, no larger icons. Active stays 800.
        style={{ fontSize: TAB_ICON_SIZE, lineHeight: TAB_ICON_SIZE + 6, color, fontWeight: focused ? '800' : '600' }}
        accessibilityElementsHidden
      >
        {glyph}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          // 78 (was 70): Arabic labels need the extra line room so
          // descenders/dots never crowd the bar's bottom edge.
          height: 78 + insets.bottom,
          paddingBottom: insets.bottom + 8,
          paddingTop: 8,
        },
        tabBarItemStyle: { minHeight: 58 },
        tabBarLabelStyle: { fontSize: Math.min(type.caption, 17), fontWeight: '700' },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {TAB_SCREENS.map((def) => (
        <Tabs.Screen
          key={def.name}
          name={def.name}
          options={{
            title: def.name === 'index' ? t(lang, 'appName') : t(lang, def.titleKey),
            tabBarAccessibilityLabel: t(lang, def.titleKey),
            tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
              <TabGlyph glyph={def.glyph} color={color} focused={focused} />
            ),
            tabBarLabel: ({ focused, color }: { focused: boolean; color: ColorValue }) => (
              <Text
                style={{
                  color,
                  // Capped: at text scale 1.3 the uncapped caption size
                  // makes the five localized labels crowd and overlap.
                  fontSize: Math.min(type.caption, 17),
                  fontWeight: focused ? '800' : '600',
                  lineHeight: Math.min(type.caption, 17) * 1.3,
                  textAlign: 'center',
                }}
              >
                {t(lang, def.titleKey)}
              </Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
