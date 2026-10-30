/**
 * Text-to-speech via expo-speech (device TTS engine, offline voices where
 * the OS provides them). Supports Arabic (ar-EG preferred, ar-SA fallback)
 * and English. Keeps the last utterance so "repeat" works everywhere.
 */
import * as Speech from 'expo-speech';
import type { AppLanguage } from './types';

export interface SpeechService {
  speak(text: string, lang: AppLanguage): Promise<void>;
  stop(): Promise<void>;
  repeatLast(): Promise<void>;
  setRate(rate: number): void;
  readonly lastText: string | null;
}

class ExpoSpeechService implements SpeechService {
  private rate = 1.0;
  private _lastText: string | null = null;
  private _lastLang: AppLanguage = 'en';

  get lastText(): string | null {
    return this._lastText;
  }

  setRate(rate: number): void {
    this.rate = Math.min(2, Math.max(0.5, rate));
  }

  async speak(text: string, lang: AppLanguage): Promise<void> {
    this._lastText = text;
    this._lastLang = lang;
    await Speech.stop();
    Speech.speak(text, {
      language: lang === 'ar' ? 'ar-EG' : 'en-US',
      rate: this.rate,
    });
  }

  async stop(): Promise<void> {
    await Speech.stop();
  }

  async repeatLast(): Promise<void> {
    if (this._lastText) {
      await this.speak(this._lastText, this._lastLang);
    }
  }

  async isSpeaking(): Promise<boolean> {
    return Speech.isSpeakingAsync();
  }
}

/** App-wide singleton. */
export const speechService: ExpoSpeechService = new ExpoSpeechService();
