/**
 * Status-bar wiring guards (device-compat fix): the root layout must
 * render a StatusBar whose barStyle follows the RESOLVED theme —
 * 'dark-content' (dark icons) on the light theme, 'light-content' on
 * dark — because the native bar is transparent and white icons vanish
 * on the ivory background. Rendered here with a mocked settings hook
 * (the jest react-native stub records the StatusBar props as data
 * attributes); the layout wiring itself is pinned by a static guard.
 * On-device icon visibility remains device-verified only.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { statusBarStyleFor, ThemedStatusBar } from '../ThemedStatusBar';

let mockIsDark = false;
jest.mock('../../state/SettingsContext', () => ({
  useSettings: () => ({ isDark: mockIsDark }),
}));

describe('statusBarStyleFor (pure mapping)', () => {
  it('light theme -> dark-content icons', () => {
    expect(statusBarStyleFor(false)).toBe('dark-content');
  });
  it('dark theme -> light-content icons', () => {
    expect(statusBarStyleFor(true)).toBe('light-content');
  });
});

describe('ThemedStatusBar render', () => {
  it('renders dark-content, transparent + translucent on the light theme', () => {
    mockIsDark = false;
    const html = renderToStaticMarkup(<ThemedStatusBar />);
    expect(html).toContain('data-barstyle="dark-content"');
    expect(html).toContain('data-background="transparent"');
    expect(html).toContain('data-translucent="true"');
  });
  it('flips to light-content when the resolved theme is dark', () => {
    mockIsDark = true;
    const html = renderToStaticMarkup(<ThemedStatusBar />);
    expect(html).toContain('data-barstyle="light-content"');
  });
});

describe('root layout wiring (static guard)', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '_layout.tsx'), 'utf8');
  it('renders ThemedStatusBar inside the provider tree (RootStack)', () => {
    expect(layout).toContain("from '../components/ThemedStatusBar'");
    expect(layout).toContain('<ThemedStatusBar />');
    // RootStack is rendered inside <SettingsProvider> by RootLayout, so
    // the bar sees the live resolved theme and reacts to changes.
    expect(layout).toContain('<SettingsProvider');
    expect(layout).toContain('<RootStack />');
  });
});
