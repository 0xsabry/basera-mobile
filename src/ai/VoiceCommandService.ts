/**
 * Voice commands: speech recognition -> pure command parser -> app action.
 *
 * The parser is pure and unit-tested in Arabic + English. The command
 * registry honestly marks which commands are implemented and which are only
 * planned (planned commands are recognized and answered with "not yet",
 * never silently faked).
 *
 * Recognition engine: expo-speech-recognition (device speech recognizer,
 * SDK 58). It needs the native dev build; where the native module or a
 * speech service is unavailable, startListening() throws a typed error
 * with an honest message. The previous recognition engine was an archived
 * library that broke Gradle configuration (jcenter/compileSdk), so it was
 * removed completely in the SDK 58 migration.
 */

export type CommandAction =
  | 'describe'
  | 'read-text'
  | 'repeat'
  | 'stop'
  | 'change-language'
  | 'open-settings'
  | 'go-home'
  | 'obstacle-check' // planned
  | 'unknown';

export interface VoiceCommand {
  action: CommandAction;
  implemented: boolean;
  /** Canonical example phrase (EN). */
  exampleEn: string;
  /** Canonical example phrase (AR). */
  exampleAr: string;
}

export const COMMAND_REGISTRY: VoiceCommand[] = [
  { action: 'describe', implemented: true, exampleEn: 'What is in front of me?', exampleAr: 'ايه اللي قدامي؟' },
  { action: 'read-text', implemented: true, exampleEn: 'Read this text', exampleAr: 'اقرأ النص' },
  { action: 'repeat', implemented: true, exampleEn: 'Repeat', exampleAr: 'كرر' },
  { action: 'stop', implemented: true, exampleEn: 'Stop speaking', exampleAr: 'اسكت / توقف' },
  { action: 'change-language', implemented: true, exampleEn: 'Change language', exampleAr: 'غير اللغة' },
  { action: 'open-settings', implemented: true, exampleEn: 'Open settings', exampleAr: 'افتح الإعدادات' },
  { action: 'go-home', implemented: true, exampleEn: 'Go home', exampleAr: 'ارجع للرئيسية' },
  { action: 'obstacle-check', implemented: false, exampleEn: 'Is the path clear? (planned)', exampleAr: 'هل الطريق فاضي؟ (مخطط)' },
];

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '') // Arabic diacritics
    .replace(/[؟?.,!،؛:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PATTERNS: { action: CommandAction; patterns: string[] }[] = [
  {
    action: 'describe',
    patterns: [
      'what is in front of me', 'what do you see', 'describe', 'describe surroundings',
      'ايه اللي قدامي', 'إيه اللي قدامي', 'صف ما حولي', 'صف اللي حولي', 'اوصف',
    ],
  },
  {
    action: 'read-text',
    patterns: ['read this text', 'read the text', 'read text', 'اقرأ النص', 'اقرا النص', 'اقرأ', 'اقرا'],
  },
  { action: 'repeat', patterns: ['repeat', 'say it again', 'كرر', 'عيد تاني', 'أعد'] },
  { action: 'stop', patterns: ['stop speaking', 'stop', 'be quiet', 'اسكت', 'توقف', 'قف', 'خلاص'] },
  { action: 'change-language', patterns: ['change language', 'switch language', 'غير اللغة', 'غيّر اللغة', 'بدل اللغة'] },
  { action: 'open-settings', patterns: ['open settings', 'settings', 'افتح الإعدادات', 'الإعدادات', 'الاعدادات'] },
  { action: 'go-home', patterns: ['go home', 'home', 'back', 'ارجع للرئيسية', 'الرئيسية', 'ارجع'] },
  {
    action: 'obstacle-check',
    patterns: ['is the path clear', 'any obstacles', 'هل الطريق فاضي', 'في عوائق', 'هل يوجد عوائق'],
  },
];

export function parseVoiceCommand(raw: string): VoiceCommand {
  const text = normalize(raw);
  for (const entry of PATTERNS) {
    for (const p of entry.patterns) {
      if (text.includes(normalize(p))) {
        const reg = COMMAND_REGISTRY.find((c) => c.action === entry.action)!;
        return reg;
      }
    }
  }
  return { action: 'unknown', implemented: false, exampleEn: '', exampleAr: '' };
}

export class VoiceUnavailableError extends Error {
  readonly code = 'VOICE_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'VoiceUnavailableError';
  }
}

export interface VoiceCommandService {
  startListening(lang: 'ar' | 'en', onResult: (transcript: string) => void, onError: (e: Error) => void): Promise<void>;
  stopListening(): Promise<void>;
}

interface SpeechRecognitionResultEventLike {
  isFinal: boolean;
  results: { transcript: string }[];
}
interface SpeechRecognitionErrorEventLike {
  error: string;
  message: string;
}
interface SpeechModuleLike {
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  isRecognitionAvailable(): boolean;
  start(options: { lang: string; interimResults: boolean; maxAlternatives: number }): void;
  stop(): void;
  addListener(
    event: 'result' | 'error',
    cb: ((ev: SpeechRecognitionResultEventLike) => void) | ((ev: SpeechRecognitionErrorEventLike) => void),
  ): { remove(): void };
}

function loadSpeechModule(): SpeechModuleLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
    if (!mod) throw new Error('ExpoSpeechRecognitionModule missing');
    return mod as SpeechModuleLike;
  } catch (e) {
    throw new VoiceUnavailableError(
      'Voice recognition is unavailable in this build. It needs the BASERA development build (native speech module); it does not run in Expo Go. ' +
        `(${e instanceof Error ? e.message : String(e)})`,
    );
  }
}

/** Thin wrapper over expo-speech-recognition's native module. */
export class NativeVoiceCommandService implements VoiceCommandService {
  private subscriptions: { remove(): void }[] = [];
  private module: SpeechModuleLike | null = null;

  private clearSubscriptions(): void {
    for (const s of this.subscriptions) {
      try {
        s.remove();
      } catch {
        // Listener already gone.
      }
    }
    this.subscriptions = [];
  }

  async startListening(
    lang: 'ar' | 'en',
    onResult: (transcript: string) => void,
    onError: (e: Error) => void,
  ): Promise<void> {
    const mod = loadSpeechModule();
    this.module = mod;

    const permission = await mod.requestPermissionsAsync();
    if (!permission.granted) {
      throw new VoiceUnavailableError(
        'Microphone permission was denied. BASERA needs microphone access for voice commands; you can grant it in system settings.',
      );
    }
    if (!mod.isRecognitionAvailable()) {
      throw new VoiceUnavailableError(
        'Speech recognition is not available on this device (no speech recognition service found). BASERA never assumes offline recognition support.',
      );
    }

    this.clearSubscriptions();
    this.subscriptions.push(
      mod.addListener('result', (ev: SpeechRecognitionResultEventLike) => {
        if (!ev.isFinal) return;
        const transcript = ev.results?.[0]?.transcript;
        if (transcript) onResult(transcript);
      }),
      mod.addListener('error', (ev: SpeechRecognitionErrorEventLike) => {
        onError(new Error(ev.message || ev.error || 'Speech recognition error'));
      }),
    );

    mod.start({
      lang: lang === 'ar' ? 'ar-EG' : 'en-US',
      interimResults: false,
      maxAlternatives: 1,
    });
  }

  async stopListening(): Promise<void> {
    try {
      this.module?.stop();
    } catch {
      // Recognizer already stopped — stopping is a no-op.
    }
    this.clearSubscriptions();
  }
}
