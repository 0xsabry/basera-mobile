/**
 * Installed-version source tests: the version the user sees must come
 * from the native package (expo-constants nativeAppVersion /
 * nativeBuildVersion), never from the OTA runtime string or from the
 * running bundle's release notes (the "1.1.1" bug, 2026-11-01).
 */
import { readInstalledVersion } from '../appVersion';

describe('readInstalledVersion', () => {
  it('labels version + build from the native package', () => {
    const v = readInstalledVersion({ nativeApplicationVersion: '1.1.6', nativeBuildVersion: '8' });
    expect(v).toEqual({ version: '1.1.6', build: '8', label: '1.1.6 (8)' });
  });

  it('labels the version alone when the build is absent', () => {
    const v = readInstalledVersion({ nativeApplicationVersion: '1.1.5', nativeBuildVersion: null });
    expect(v.label).toBe('1.1.5');
  });

  it('reports nulls honestly when native constants are absent', () => {
    const v = readInstalledVersion({});
    expect(v).toEqual({ version: null, build: null, label: null });
  });
});

describe('version-display wiring (guards)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path') as typeof import('path');
  const updates = readFileSync(join(__dirname, '..', '..', 'app', 'updates.tsx'), 'utf8');
  const settings = readFileSync(join(__dirname, '..', '..', 'app', '(tabs)', 'settings.tsx'), 'utf8');

  it('the Updates screen renders the installed native version', () => {
    expect(updates).toContain('readInstalledVersion');
    expect(updates).toContain("infoRow(t(lang, 'versionLabel'), installed.label");
  });

  it('Settings About + the Updates row use the installed version, not the runtime string', () => {
    expect(settings).toContain('readInstalledVersion');
    // The old conflation: versionLabel rendered the runtimeVersion.
    expect(settings).not.toMatch(/versionLabel'\)\}: \{updateStatus\.runtimeVersion/);
    expect(settings).not.toMatch(/versionLabel'\)\}: \$\{updateStatus\.runtimeVersion/);
  });
});
