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
import { resolveVoiceIdentifier, type VoiceLike, type VoicePreference } from './voiceCatalog';

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
  /**
   * Settings: the three-state voice preference. 'auto' (the default)
   * resolves Arabic utterances to the device's exact ar-EG voice when
   * one is installed (see voiceCatalog.selectEgyptianVoice); 'system'
   * is an EXPLICIT user choice of the OS default voice and is never
   * treated as uninitialized; 'custom' pins one chosen identifier.
   */
  setVoicePreference(pref: VoicePreference): void;
  /**
   * Feed a freshly listed device voice catalog into the service so
   * 'auto' resolution and utterances share one discovery (the voice
   * picker calls this with the list it already fetched).
   */
  noteAvailableVoices(voices: VoiceLike[]): void;
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
   * Bug 4 stale-voice guard: validate a CUSTOM selection against the
   * identifiers the device actually offers. A persisted identifier the
   * device no longer has (voice data removed, engine changed) can make
   * expo-speech fail EVERY utterance silently, so a stale custom
   * selection falls back to the 'auto' preference. 'auto' and 'system'
   * carry no identifier and are always valid.
   * Returns true when the preference needed no repair; false when a
   * stale custom identifier was reset to 'auto'.
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
  private voicePreference: VoicePreference = { kind: 'auto' };
  /** Device voice catalog cache for 'auto' resolution. Populated by
   *  noteAvailableVoices (picker) or lazily by discoverVoices(). A
   *  discovery FAILURE is not cached, so a later utterance may retry;
   *  a successful listing (even an empty one) is. */
  private availableVoices: VoiceLike[] | null = null;
  private voicesInFlight: Promise<VoiceLike[]> | null = null;
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

  setVoicePreference(pref: VoicePreference): void {
    this.voicePreference = pref;
  }

  noteAvailableVoices(voices: VoiceLike[]): void {
    this.availableVoices = voices ?? [];
  }

  /** Lazily discover the device voices for 'auto' resolution. Never
   *  rejects: a discovery failure yields an empty list, which resolves
   *  to the language-only fallback — speech must keep working. */
  private async discoverVoices(): Promise<VoiceLike[]> {
    if (this.availableVoices) return this.availableVoices;
    if (!this.voicesInFlight) {
      this.voicesInFlight = (async () => {
        try {
          const all = await Speech.getAvailableVoicesAsync();
          const list = (all ?? []) as VoiceLike[];
          this.availableVoices = list;
          return list;
        } catch {
          return [];
        } finally {
          this.voicesInFlight = null;
        }
      })();
    }
    return this.voicesInFlight;
  }

  validateVoiceSelection(availableIds: Set<string>): boolean {
    if (this.voicePreference.kind !== 'custom') return true;
    if (availableIds.has(this.voicePreference.identifier)) return true;
    // Stale persisted voice: the device no longer offers it. Keeping it
    // risks silent failure of every utterance — fall back to 'auto'.
    this.voicePreference = { kind: 'auto' };
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
    // preference. Otherwise the preference resolves via voiceCatalog:
    // 'custom' pins its identifier, 'system' passes no voice, and
    // 'auto' picks the device's exact ar-EG voice for Arabic (after a
    // lazy, cached discovery) or no voice when none exists — the
    // ar-EG `language` tag below remains the fallback either way.
    // NOTE on language: when a voice is passed, expo-speech speaks
    // with THAT voice's own language; the `language` field (ar-EG /
    // en-US for the requested group) is the fallback the engine uses
    // when no voice is selected.
    let effectiveVoice: string | null;
    if (opts?.hasVoiceOverride) {
      effectiveVoice = opts.voiceOverride ?? null;
    } else if (this.voicePreference.kind === 'auto' && lang === 'ar') {
      effectiveVoice = resolveVoiceIdentifier(this.voicePreference, await this.discoverVoices(), lang);
    } else {
      effectiveVoice = resolveVoiceIdentifier(this.voicePreference, [], lang);
    }
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
