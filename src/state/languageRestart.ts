/**
 * Language-switch restart coordination (Bug 2 fix).
 *
 * React Native only applies an I18nManager.forceRTL() change on reload:
 * switching between Arabic (RTL) and English (LTR) without restarting
 * leaves the running UI in the OLD direction while the strings switch —
 * the mixed, broken interface the owner reported. This module owns the
 * decision + the safe restart: announce in the NEW language first, never
 * reload while an accessibility operation is busy (speech, recognition,
 * processing, hazard handling — see accessibilityBusy), and report
 * honestly when the native updates module cannot reload at all
 * (Expo Go / dev builds where expo-updates is disabled), so the caller
 * can surface that a manual restart is needed instead of pretending.
 *
 * Framework-free and fully unit-testable: every effect (busy check,
 * busy subscription, reload, announcement, delay) is injected.
 */
import type { AppLanguage } from '../ai/types';

export function isRTLLanguage(lang: AppLanguage): boolean {
  return lang === 'ar';
}

/** True only when the switch flips layout direction (ar↔en). */
export function needsDirectionRestart(prevLang: AppLanguage, nextLang: AppLanguage): boolean {
  return isRTLLanguage(prevLang) !== isRTLLanguage(nextLang);
}

export type LanguageRestartStatus = 'restarted' | 'deferred' | 'unavailable' | 'already-pending';

export interface LanguageRestartDeps {
  /** True while an accessibility-critical operation is in progress. */
  isBusy(): boolean;
  /** Subscribe to busy-state changes; returns an unsubscribe function. */
  subscribeBusy(cb: () => void): () => void;
  /** Reload the app (expo-updates reloadAsync in production wiring). */
  reload(): Promise<void>;
  /** Fire-and-forget spoken announcement (already in the NEW language). */
  announce(msg: string): void;
  /** True when the native updates module is present and enabled. */
  canReload(): boolean;
  /** Injectable timer so the announcement can start before the reload. */
  delay?(ms: number): Promise<void>;
}

/** How long the restart announcement gets to start before reload. */
export const ANNOUNCE_DELAY_MS = 600;

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class LanguageRestartCoordinator {
  private deps: Required<LanguageRestartDeps>;
  private pending = false;
  private unsubscribe: (() => void) | null = null;

  constructor(deps: LanguageRestartDeps) {
    this.deps = { ...deps, delay: deps.delay ?? defaultDelay };
  }

  /** True while a deferred (busy) or in-flight restart is outstanding. */
  get isPending(): boolean {
    return this.pending;
  }

  /**
   * Request the restart for a direction-flipping language change.
   * - reload unavailable → 'unavailable', nothing announced, no reload;
   *   the caller surfaces the manual-restart state.
   * - busy → announce deferredText, reload exactly once when busy clears
   *   (announcing noticeText first); returns 'deferred'.
   * - idle → announce noticeText, then reload; returns 'restarted'.
   * - a second request while one is pending → 'already-pending' no-op.
   */
  requestLanguageChange(noticeText: string, deferredText: string): LanguageRestartStatus {
    if (this.pending) return 'already-pending';
    if (!this.deps.canReload()) return 'unavailable';
    if (this.deps.isBusy()) {
      this.pending = true;
      try {
        this.deps.announce(deferredText);
      } catch {
        // A failed announcement must not lose the pending restart.
      }
      this.unsubscribe = this.deps.subscribeBusy(() => {
        if (!this.pending || this.deps.isBusy()) return;
        void this.proceed(noticeText);
      });
      return 'deferred';
    }
    this.pending = true;
    void this.proceed(noticeText);
    return 'restarted';
  }

  private async proceed(noticeText: string): Promise<void> {
    const unsub = this.unsubscribe;
    this.unsubscribe = null;
    if (unsub) unsub();
    try {
      this.deps.announce(noticeText);
      await this.deps.delay(ANNOUNCE_DELAY_MS);
      await this.deps.reload();
    } catch {
      // Swallow: a failed reload must never crash or loop. The persisted
      // language + direction flag still apply on the next cold start.
    } finally {
      this.pending = false;
    }
  }
}
