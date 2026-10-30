/**
 * Accessibility-busy registry (V1.1 Phase 0, OTA safety rule).
 *
 * An OTA update must NEVER reload the app while an accessibility-critical
 * operation is in progress: speech output (TTS), speech recognition,
 * camera/image processing, OCR, detection, or hazard-alert handling.
 * Services and screens register their busy state here; the UpdateService
 * consults isAccessibilityBusy() before any reloadAsync() call, and the
 * update screen disables "Restart to apply" while busy.
 *
 * Module-level by design: the guard must be reachable from services that
 * are not React components (SpeechService, UpdateService).
 */
export type AccessibilityBusySource = 'speech' | 'recognition' | 'processing' | 'hazard';

const counts = new Map<AccessibilityBusySource, number>();

export function setAccessibilityBusy(source: AccessibilityBusySource, busy: boolean): void {
  const next = (counts.get(source) ?? 0) + (busy ? 1 : -1);
  counts.set(source, Math.max(0, next));
}

export function isAccessibilityBusy(): boolean {
  for (const n of counts.values()) {
    if (n > 0) return true;
  }
  return false;
}

export function accessibilityBusySources(): AccessibilityBusySource[] {
  const active: AccessibilityBusySource[] = [];
  for (const [source, n] of counts.entries()) {
    if (n > 0) active.push(source);
  }
  return active;
}

/** Test helper: reset all counters. */
export function resetAccessibilityBusy(): void {
  counts.clear();
}
