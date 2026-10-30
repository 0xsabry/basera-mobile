/**
 * Vibration feedback helper — the single place vibration patterns are
 * defined and the single gate for the user's "Vibration alerts" setting.
 *
 * Uses React Native's Vibration (no extra native module). Patterns are
 * distinguishable: a single short buzz for ordinary confirmations, a
 * double buzz for medium alerts, and a long triple pattern for high
 * hazard alerts — critical for users who cannot see the screen.
 *
 * When the setting is OFF, every helper here is a no-op. The gate is a
 * module-level flag synced from SettingsProvider (same pattern as the
 * accessibility-busy registry), so services can call it without React.
 */
import { Vibration } from 'react-native';

export type VibrateFn = (pattern: number | number[]) => void;

const defaultVibrate: VibrateFn = (pattern) => {
  try {
    Vibration.vibrate(pattern);
  } catch {
    // Vibration unavailable (web / some devices) — never crash on feedback.
  }
};

let vibrateImpl: VibrateFn = defaultVibrate;
let enabled = true;

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

export function isHapticsEnabled(): boolean {
  return enabled;
}

/** Test seam: replace the platform vibrate implementation. */
export function setVibrateImplForTests(fn: VibrateFn | null): void {
  vibrateImpl = fn ?? defaultVibrate;
}

function buzz(pattern: number | number[]): void {
  if (!enabled) return;
  vibrateImpl(pattern);
}

/** Short single buzz — key action confirmed. */
export function hapticConfirm(): void {
  buzz(40);
}

/** Double buzz — medium-risk alert. */
export function hapticAlertMedium(): void {
  buzz([0, 160, 120, 160]);
}

/** Long triple pattern — high-risk hazard alert / SOS. Unmistakable. */
export function hapticAlertHigh(): void {
  buzz([0, 400, 150, 400, 150, 400]);
}
