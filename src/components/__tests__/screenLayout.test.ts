/**
 * Tablet / large-screen layout guards (device-compat fix): the shared
 * Screen scaffold caps its content column at SCREEN_MAX_WIDTH (600dp),
 * centered, on wide screens, while the window background stays
 * full-bleed. On phones nothing changes. These guards pin the cap so a
 * future refactor cannot silently un-cap tablet layouts; the visual
 * result is verified in the labeled web previews (834×1112 / 1180×820).
 */
import fs from 'fs';
import path from 'path';

// Same mock as the UI smoke tests: the real package loads RN native
// internals (ESM) the node harness cannot execute.
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
}));

import { SCREEN_MAX_WIDTH } from '../ui';

const ui = fs.readFileSync(path.join(__dirname, '..', 'ui.tsx'), 'utf8');

describe('Screen tablet width cap', () => {
  it('caps content at 600dp', () => {
    expect(SCREEN_MAX_WIDTH).toBe(600);
  });
  it('Screen applies the cap centered, at full width below the cap', () => {
    expect(ui).toContain('maxWidth: SCREEN_MAX_WIDTH');
    expect(ui).toContain("alignSelf: 'center'");
    expect(ui).toContain("width: '100%'");
  });
  it('the background stays full-bleed outside the capped column', () => {
    // Both Screen branches paint the theme background on the OUTER
    // (uncapped) container; only the inner content View is capped.
    expect(ui).toContain("style={{ flex: 1, backgroundColor: colors.background }}");
    expect(ui).toContain('style={{ backgroundColor: colors.background }}');
  });
});
