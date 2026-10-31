/**
 * Theme-driven status bar (device-compat fix, 2026-10-31).
 *
 * The native theme makes the Android status bar transparent
 * (edge-to-edge) but nothing ever told it which icon color to use, so
 * in the LIGHT theme the white system icons (clock, battery) sat on
 * the near-white ivory background and vanished. This component renders
 * React Native's built-in StatusBar with a barStyle that follows the
 * RESOLVED theme from SettingsContext — it lives inside the provider
 * tree (root layout), so it flips live when the user changes theme in
 * Settings: light theme → dark icons ('dark-content'), dark theme →
 * light icons ('light-content'). The bar itself stays transparent so
 * the edge-to-edge look is unchanged.
 */
import React from 'react';
import { StatusBar, type StatusBarStyle } from 'react-native';
import { useSettings } from '../state/SettingsContext';

/** Pure mapping, unit-tested: resolved darkness → status-bar icon style. */
export function statusBarStyleFor(isDark: boolean): StatusBarStyle {
  return isDark ? 'light-content' : 'dark-content';
}

export function ThemedStatusBar() {
  const { isDark } = useSettings();
  return <StatusBar barStyle={statusBarStyleFor(isDark)} backgroundColor="transparent" translucent />;
}
