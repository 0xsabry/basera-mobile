/**
 * Text-to-speech via expo-speech (device TTS engine, offline voices where
 * the OS provides them). Supports Arabic (ar-EG preferred, ar-SA fallback)
 * and English.
 *
 * Repeat semantics (ROOT CAUSE 3 fix): only MEANINGFUL responses are
 * repeatable — scene descriptions, OCR text, assistant answers — via
 * speak(). Announcements (welcome greeting, status confirmations) go
 * through speakAnnouncement() and NEVER overwrite the repeat target, so
 * pressing "Repeat" after onboarding no longer replays the welcome.
 */
import * as Speech from 'expo-speech';
import { t } from '../i18n/strings';
import { setAccessibilityBusy } from '../state/accessibilityBusy';
import type { AppLanguage } from './types';

export interface SpeechService {
  /** Speak a meaningful, repeatable response. Becomes the repeat target. */
  speak(text: string, lang: AppLanguage): Promise<void>;
  /** Speak a one-off announcement. Does NOT become the repeat target. */
  speakAnnouncement(text: string, lang: AppLanguage): Promise<void>;
  /**
   * Speak a hazard alert. Becomes the ALERT repeat target (repeatAlert),
   * deliberately separate from the ordinary repeat target — after an
   * alert, "repeat the warning" must replay the warning, while plain
   * "repeat" keeps its established meaning (latest useful response).
   */
  speakAlert(text: string, lang: AppLanguage): Promise<void>;
  stop(): Promise<void>;
  /** Re-speak the last meaningful response, or say there is nothing yet. */
  repeatLast(): Promise<void>;
  /** Re-speak the last hazard alert, or say there is nothing yet. */
  repeatAlert(): Promise<void>;
  setRate(rate: number): void;
  /** Settings gate: when false, ALL speech output is suppressed. */
  setSpeechEnabled(enabled: boolean): void;
  /** Settings: chosen TTS voice identifier (null = OS default voice). */
  setVoiceIdentifier(identifier: string | null): void;
  /**
   * Bug 4: speak a short sample with the GIVEN voice (null = system
   * default) so the Settings picker can audition a voice before/instead
   * of selecting it. Resolves true only when the utterance completes
   * (onDone); false on engine error, a synchronous throw, interruption,
   * or when the speech gate is off. Uses announcement semantics: it
   * never becomes the repeat target.
   */
  testSpeak(voiceIdentifier: string | null, sampleLang: AppLanguage): Promise<boolean>;
  /**
   * Bug 4 stale-voice guard: validate the currently selected voice
   * against the identifiers the device actually offers. A persisted
   * identifier the device no longer has (voice data removed, engine
   * changed) can make expo-speech fail EVERY utterance silently, so a
   * stale selection is cleared back to the system default.
   * Returns true when the selection is valid (null or present in
   * `availableIds`); false when a stale identifier was cleared.
   */
  validateVoiceSelection(availableIds: Set<string>): boolean;
  readonly lastText: string | null;
  readonly lastAlertText: string | null;
}

export class ExpoSpeechService implements SpeechService {
  private rate = 1.0;
  private _lastText: string | null = null;
  private _lastAlertText: string | null = null;
  private _lastLang: AppLanguage = 'en';
  private speechEnabled = true;
  private voiceIdentifier: string | null = null;
  /** Clear-callback of the utterance currently playing, so stop() can
   *  release the accessibility-busy guard even when the TTS engine
   *  never fires onStopped (web / interrupted engines). */
  private activeClearBusy: (() => void) | null = null;

  get lastText(): string | null {
    return this._lastText;
  }

  get lastAlertText(): string | null {
    return this._lastAlertText;
  }

  setRate(rate: number): void {
    this.rate = Math.min(2, Math.max(0.5, rate));
  }

  setSpeechEnabled(enabled: boolean): void {
    this.speechEnabled = enabled;
    if (!enabled) {
      // Turning speech off must also silence anything currently playing
      // (and release the busy guard via stop()).
      void this.stop().catch(() => undefined);
    }
  }

  setVoiceIdentifier(identifier: string | null): void {
    this.voiceIdentifier = identifier;
  }

  validateVoiceSelection(availableIds: Set<string>): boolean {
    if (this.voiceIdentifier === null) return true;
    if (availableIds.has(this.voiceIdentifier)) return true;
    // Stale persisted voice: the device no longer offers it. Keeping it
    // risks silent failure of every utterance — fall back to default.
    this.voiceIdentifier = null;
    return false;
  }

  async testSpeak(voiceIdentifier: string | null, sampleLang: AppLanguage): Promise<boolean> {
    if (!this.speechEnabled) return false;
    const sample = t(sampleLang, sampleLang === 'ar' ? 'voiceSampleAr' : 'voiceSampleEn');
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      // Announcement path semantics: utter() never records a repeat
      // target (only speak()/speakAlert() do), so the audition cannot
      // clobber what "Repeat" would replay.
      this.utter(sample, sampleLang, {
        hasVoiceOverride: true,
        voiceOverride: voiceIdentifier,
        onOutcome: settle,
      }).catch(() => settle(false));
    });
  }

  private async utter(
    text: string,
    lang: AppLanguage,
    opts?: {
      /** When hasVoiceOverride is set, use this voice instead of the
       *  persisted selection (null = system default) — testSpeak only. */
      hasVoiceOverride?: boolean;
      voiceOverride?: string | null;
      /** testSpeak completion: true on onDone, false otherwise. */
      onOutcome?: (ok: boolean) => void;
    },
  ): Promise<void> {
    // Settings gate: speech output disabled → complete no-op (visual and
    // vibration feedback channels remain available to callers).
    if (!this.speechEnabled) {
      opts?.onOutcome?.(false);
      return;
    }
    // Track the most recent speech language (NOT the repeat target) so the
    // "nothing to repeat" message is spoken in the user's current language.
    this._lastLang = lang;
    await Speech.stop();
    // OTA safety: while speech is playing, an update reload is forbidden
    // (see state/accessibilityBusy + update/UpdateService).
    setAccessibilityBusy('speech', true);
    let cleared = false;
    const clearBusy = () => {
      if (cleared) return;
      cleared = true;
      if (this.activeClearBusy === clearBusy) this.activeClearBusy = null;
      setAccessibilityBusy('speech', false);
    };
    // stop() releases the guard through activeClearBusy; routing it
    // through onOutcome(false) also settles a pending testSpeak whose
    // utterance was interrupted before any engine callback fired.
    this.activeClearBusy = () => {
      clearBusy();
      opts?.onOutcome?.(false);
    };
    // Voice selection: a testSpeak override wins over the persisted
    // selection. NOTE on language: when a voice is passed, expo-speech
    // speaks with THAT voice's own language; the `language` field below
    // (ar-EG / en-US for the requested group) is the fallback the engine
    // uses when no voice is selected. The picker stores only the
    // identifier, so SpeechService cannot know a selected voice's group
    // — keeping `language` consistent with the caller's requested group
    // is the correct contract, and the picker only ever pairs a voice
    // with a sample of its own group.
    const effectiveVoice = opts?.hasVoiceOverride ? opts.voiceOverride : this.voiceIdentifier;
    try {
      Speech.speak(text, {
        language: lang === 'ar' ? 'ar-EG' : 'en-US',
        rate: this.rate,
        ...(effectiveVoice ? { voice: effectiveVoice } : {}),
        onDone: () => {
          clearBusy();
          opts?.onOutcome?.(true);
        },
        onStopped: () => {
          clearBusy();
          opts?.onOutcome?.(false);
        },
        onError: () => {
          clearBusy();
          opts?.onOutcome?.(false);
        },
      });
    } catch (e) {
      // Synchronous TTS failure: no callback will ever fire, so the
      // busy guard must be released here or OTA reload stays blocked.
      clearBusy();
      if (opts?.onOutcome) {
        // testSpeak contract: a failed audition RESOLVES false rather
        // than rejecting — the picker shows fallback guidance instead.
        opts.onOutcome(false);
        return;
      }
      throw e;
    }
  }

  async speak(text: string, lang: AppLanguage): Promise<void> {
    this._lastText = text;
    this._lastLang = lang;
    await this.utter(text, lang);
  }

  async speakAnnouncement(text: string, lang: AppLanguage): Promise<void> {
    await this.utter(text, lang);
  }

  async speakAlert(text: string, lang: AppLanguage): Promise<void> {
    this._lastAlertText = text;
    this._lastLang = lang;
    await this.utter(text, lang);
  }

  async repeatAlert(): Promise<void> {
    if (this._lastAlertText) {
      await this.utter(this._lastAlertText, this._lastLang);
    } else {
      await this.utter(t(this._lastLang, 'nothingToRepeat'), this._lastLang);
    }
  }

  async stop(): Promise<void> {
    try {
      await Speech.stop();
    } finally {
      // Idempotent: clearBusy() no-ops if onStopped already fired.
      this.activeClearBusy?.();
    }
  }

  async repeatLast(): Promise<void> {
    if (this._lastText) {
      await this.speak(this._lastText, this._lastLang);
    } else {
      // Nothing meaningful spoken yet. Say so WITHOUT making that message
      // itself the repeat target.
      await this.utter(t(this._lastLang, 'nothingToRepeat'), this._lastLang);
    }
  }

  async isSpeaking(): Promise<boolean> {
    return Speech.isSpeakingAsync();
  }
}

/** App-wide singleton. */
export const speechService: ExpoSpeechService = new ExpoSpeechService();
