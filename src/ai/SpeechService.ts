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
  stop(): Promise<void>;
  /** Re-speak the last meaningful response, or say there is nothing yet. */
  repeatLast(): Promise<void>;
  setRate(rate: number): void;
  readonly lastText: string | null;
}

export class ExpoSpeechService implements SpeechService {
  private rate = 1.0;
  private _lastText: string | null = null;
  private _lastLang: AppLanguage = 'en';

  get lastText(): string | null {
    return this._lastText;
  }

  setRate(rate: number): void {
    this.rate = Math.min(2, Math.max(0.5, rate));
  }

  private async utter(text: string, lang: AppLanguage): Promise<void> {
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
      setAccessibilityBusy('speech', false);
    };
    Speech.speak(text, {
      language: lang === 'ar' ? 'ar-EG' : 'en-US',
      rate: this.rate,
      onDone: clearBusy,
      onStopped: clearBusy,
      onError: clearBusy,
    });
  }

  async speak(text: string, lang: AppLanguage): Promise<void> {
    this._lastText = text;
    this._lastLang = lang;
    await this.utter(text, lang);
  }

  async speakAnnouncement(text: string, lang: AppLanguage): Promise<void> {
    await this.utter(text, lang);
  }

  async stop(): Promise<void> {
    await Speech.stop();
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
