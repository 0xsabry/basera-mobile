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
 * v1.1.2 state separation: owners could not tell the active tab at a
 * glance — the two tints were both dark greens (light theme) and the
 * only other cue was weight. Now (1) the inactive tint is a NEUTRAL
 * grey while the active tint stays brand green (theme tokens),
 * (2) the active tab carries a short indicator BAR above its glyph —
 * a shape cue that survives color-vision differences — and
 * (3) weights stay 800/600.
 *
 * v1.1.3 (owner order): the indicator bar is FOLDED INTO a soft
 * rounded-square CONTAINER behind the active glyph (token
 * tabActiveContainer) — one coherent shape cue instead of two, in
 * the brand navy/royal identity: active glyph = navy/bright tint on
 * the soft-blue container, inactive = slate glyph on transparency.
 * Same fixed box in both states (48×36, radius 12), so selection
 * never shifts layout; glyph-on-container is locked ≥ 9:1 in the
 * contrast suite alongside glyph-on-surface. Labels live in a
 * fixed two-line zone:
 * «المساعد الذكي» / "Smart Assistant" is wider than its tab on one
 * line at a readable size, so it wraps at its word boundary inside
 * the zone (short labels stay on line one — glyph columns align
 * across all five tabs, nothing clips, nothing shrinks to
 * illegibility). An earlier shrink-to-fit attempt was reverted: it
 * is not honored by every renderer and silently ellipsized the
 * mandated label in the web preview.
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
        paddingHorizontal: 14,
        paddingVertical: 3,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* v1.1.3 shape cue: a fixed 48×36 rounded-square container
          (radius 12) behind the glyph. ACTIVE: filled with the soft
          brand tint (tabActiveContainer) — the emphasis the v1.1.2
          indicator bar used to carry, folded into one shape.
          INACTIVE: the same box, transparent, so the glyph column
          never shifts when selection changes. */}
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
          // 88: glyph container (36 + padding) + the fixed two-line
          // label zone (41.6) + breathing room. Arabic labels need
          // the line room so descenders/dots never crowd the edge.
          height: 88 + insets.bottom,
          paddingBottom: insets.bottom + 8,
          paddingTop: 8,
        },
        tabBarItemStyle: { minHeight: 68 },
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
              <TabGlyph glyph={def.glyph} color={color} containerColor={colors.tabActiveContainer} focused={focused} />
            ),
            tabBarLabel: ({ focused, color }: { focused: boolean; color: ColorValue }) => (
              // Fixed two-line zone: every tab reserves the same label
              // height, so a label that wraps («المساعد الذكي»,
              // "Smart Assistant") never pushes its glyph out of line
              // with the others, and a short label simply uses line 1.
              <View
                style={{
                  height: Math.min(type.caption, 17) * 1.3 * 2,
                  justifyContent: 'flex-start',
                  alignItems: 'center',
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    color,
                    // Capped: at text scale 1.3 the uncapped caption
                    // size makes the five localized labels crowd.
                    fontSize: Math.min(type.caption, 17),
                    fontWeight: focused ? '800' : '600',
                    lineHeight: Math.min(type.caption, 17) * 1.3,
                    textAlign: 'center',
                  }}
                >
                  {t(lang, def.titleKey)}
                </Text>
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
