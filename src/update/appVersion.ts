/**
 * The INSTALLED app's version — read from the native package itself.
 *
 * Why this module exists (bug, owner report 2026-11-01): the Updates
 * screen and the Settings About line used to present the OTA
 * runtimeVersion ("1.1.0", an internal compatibility string shared by
 * every 1.1.x build) and the running bundle's baked-in release note as
 * "the version". Neither is the installed version: the runtime never
 * changes across 1.1.x releases, and the note is only as fresh as the
 * last applied OTA bundle — a phone still running an old bundle showed
 * the old note's "1.1.1" text while its installed APK was 1.1.5/1.1.6.
 *
 * Source choice (SDK 58 evidence): expo-constants no longer exposes
 * nativeAppVersion/nativeBuildVersion — neither in its types nor its
 * JS — and its own type comments direct readers to expo-application.
 * `Constants.expoConfig.version` is NOT a safe substitute: under EAS
 * Update it reflects the RUNNING update's exported config, i.e. it is
 * exactly as stale as the bundle. expo-application instead reads
 * Android PackageInfo (versionName / versionCode) of the installed
 * APK, which no OTA bundle can change. The package is already in the
 * install tree (a dependency of expo-notifications, which the app
 * uses for guardian push tokens) and its JS degrades to null when the
 * native module is absent. The source is injectable for unit tests.
 */
import * as Application from 'expo-application';

export interface VersionSource {
  nativeApplicationVersion?: string | null;
  nativeBuildVersion?: string | null;
}

export interface InstalledVersion {
  /** e.g. "1.1.6" — null only when the native module is absent. */
  version: string | null;
  /** e.g. "8" (Android versionCode) — null when absent. */
  build: string | null;
  /** "1.1.6 (8)" — the one-line label the UI renders. */
  label: string | null;
}

export function readInstalledVersion(source: VersionSource = Application): InstalledVersion {
  const version = source.nativeApplicationVersion ?? null;
  const build = source.nativeBuildVersion ?? null;
  return {
    version,
    build,
    label: version ? (build ? `${version} (${build})` : version) : null,
  };
}
