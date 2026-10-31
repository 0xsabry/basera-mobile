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
 * light icons ('light-content'). The bar's background/translucency
 * stay exactly as the native theme defines them (transparent,
 * edge-to-edge) — only the icon contrast changes. (RN 0.88's
 * StatusBar component types no longer carry the Android-only
 * backgroundColor/translucent props, and the native theme already
 * owns both, so the component passes barStyle only.)
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
  return <StatusBar barStyle={statusBarStyleFor(isDark)} />;
}
