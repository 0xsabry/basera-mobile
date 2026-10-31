/**
 * Main bottom navigation — five destinations, always reachable:
 * Home, Assistance, History, Family, Settings.
 *
 * V1.1 premium redesign: the active tab is marked by accent glyph
 * color + bold label under a top hairline — never by color alone.
 * Accessibility contract unchanged: every tab is a ≥58dp touch
 * target with a text label (never icon-only), an explicit
 * screen-reader label, and the bar respects the device safe area.
 *
 * v1.1.2 state separation: (1) the inactive tint is a NEUTRAL grey
 * while the active tint stays brand, (2) a shape cue marks the
 * active tab, (3) weights stay 800/600.
 *
 * v1.1.3 (owner order): the shape cue is a soft rounded-square
 * CONTAINER behind the active glyph (token tabActiveContainer) —
 * same fixed box in both states (48×36, radius 12), so selection
 * never shifts layout; glyph-on-container is locked ≥ 9:1.
 *
 * v1.1.4 (owner order): SINGLE-LINE labels — the v1.1.3 two-line
 * zone is reverted. «المساعد الذكي» / "Smart Assistant" is wider
 * than a fifth of a 360dp screen at any readable fixed size, so
 * the label size is DERIVED from the window width: measured
 * advance ratios for the longest label of each language (bold,
 * incl. safety margin — AR 7.3, EN 8.1 px of width per 1px of
 * font size) give the largest size that fits the tab width,
 * clamped to [8.5, 13]. `adjustsFontSizeToFit` (floor 0.8) stays
 * as the on-device safety net for font-metric differences.
 * Verified in the v1.1.4 web previews at 360×740 and 390×844:
 * every label's scrollWidth ≤ its clientWidth — no ellipsis.
 * Bar labels intentionally do NOT follow the app text scale (the
 * previous design capped them for the same reason): the bar
 * geometry is fixed, and TalkBack reads the full label regardless.
 *
 * Sub-screens (detect, read, voice, updates, guardian-auth, places,
 * alerts, onboarding) are stack routes in the root layout, pushed
 * above the tabs, so the tab bar never covers their controls.
 */
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View, type ColorValue } from 'react-native';
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

/**
 * Measured advance width of each language's longest tab label per
 * 1px of font size (weight 800, safety margin included). Derived
 * from browser text measurement of «المساعد الذكي» (7.19 raw) and
 * "Smart Assistant" (8.04 raw) — see docs/IDENTITY_OLIVE_1.1.4.md.
 */
const LABEL_WIDTH_RATIO = { ar: 7.3, en: 8.1 } as const;
const LABEL_MIN_SIZE = 8.5;
const LABEL_MAX_SIZE = 13;

function TabGlyph({
  glyph,
  color,
  containerColor,
  focused,
}: {
  glyph: string;
  color: ColorValue;
  containerColor: ColorValue;
  focused: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: 'transparent',
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Shape cue: a fixed 48×36 rounded-square container (radius
          12) behind the glyph. ACTIVE: filled with the soft brand
          tint (tabActiveContainer). INACTIVE: the same box,
          transparent, so the glyph column never shifts. */}
      <View
        accessibilityElementsHidden
        style={{
          width: 48,
          height: 36,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: focused ? containerColor : 'transparent',
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
    </View>
  );
}

export default function TabsLayout() {
  const { settings, colors } = useSettings();
  const lang = settings.language;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Single-line fit: the largest label size (0.5 steps) whose
  // measured advance fits the tab width, per language.
  const tabWidth = width / TAB_SCREENS.length;
  const fitSize = Math.floor(((tabWidth - 2) / LABEL_WIDTH_RATIO[lang]) * 2) / 2;
  const labelFontSize = Math.max(LABEL_MIN_SIZE, Math.min(LABEL_MAX_SIZE, fitSize));

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
          // 70: glyph container (36 + padding) + ONE label line +
          // breathing room (the v1.1.3 two-line zone needed 88).
          height: 70 + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarItemStyle: { minHeight: 58 },
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
              <TabGlyph glyph={def.glyph} color={color} containerColor={colors.tabActiveContainer} focused={focused} />
            ),
            tabBarLabel: ({ focused, color }: { focused: boolean; color: ColorValue }) => (
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={{
                  color,
                  fontSize: labelFontSize,
                  fontWeight: focused ? '800' : '600',
                  lineHeight: labelFontSize * 1.4,
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
