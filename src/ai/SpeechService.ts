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

  private async utter(text: string, lang: AppLanguage): Promise<void> {
    // Settings gate: speech output disabled → complete no-op (visual and
    // vibration feedback channels remain available to callers).
    if (!this.speechEnabled) return;
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
    this.activeClearBusy = clearBusy;
    try {
      Speech.speak(text, {
        language: lang === 'ar' ? 'ar-EG' : 'en-US',
        rate: this.rate,
        ...(this.voiceIdentifier ? { voice: this.voiceIdentifier } : {}),
        onDone: clearBusy,
        onStopped: clearBusy,
        onError: clearBusy,
      });
    } catch (e) {
      // Synchronous TTS failure: no callback will ever fire, so the
      // busy guard must be released here or OTA reload stays blocked.
      clearBusy();
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
