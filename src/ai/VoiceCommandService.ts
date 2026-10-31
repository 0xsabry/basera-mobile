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
  | 'sos'
  | 'acknowledge-ok'
  | 'save-place'
  | 'save-place-unnamed'
  | 'add-place-note'
  | 'list-places'
  | 'find-place'
  | 'near-place'
  | 'delete-place'
  | 'describe-place'
  | 'obstacle-check' // planned
  | 'unknown';

export interface ParsedCommand extends VoiceCommand {
  /** Extracted argument (e.g. a place name) for parameterized commands. */
  argument?: string;
}

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
  { action: 'sos', implemented: true, exampleEn: 'SOS / Help me', exampleAr: 'استغاثة' },
  { action: 'acknowledge-ok', implemented: true, exampleEn: "I'm okay", exampleAr: 'أنا بخير' },
  { action: 'save-place', implemented: true, exampleEn: 'Save this place as Home', exampleAr: 'احفظ المكان ده باسم البيت' },
  { action: 'save-place-unnamed', implemented: true, exampleEn: 'Save this place', exampleAr: 'احفظ المكان ده' },
  { action: 'add-place-note', implemented: true, exampleEn: 'Add a note to the place Home', exampleAr: 'ضيف ملاحظة للمكان ده' },
  { action: 'list-places', implemented: true, exampleEn: 'What places have I saved?', exampleAr: 'إيه الأماكن اللي حفظتها؟' },
  { action: 'find-place', implemented: true, exampleEn: 'Where is the university?', exampleAr: 'فين الجامعة؟' },
  { action: 'near-place', implemented: true, exampleEn: 'Am I near home?', exampleAr: 'أنا قريب من البيت؟' },
  { action: 'delete-place', implemented: true, exampleEn: 'Delete the saved place Club', exampleAr: 'امسح المكان المحفوظ باسم النادي' },
  { action: 'describe-place', implemented: true, exampleEn: 'Repeat the place description', exampleAr: 'كرر وصف المكان' },
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

interface PatternEntry {
  action: CommandAction;
  patterns: string[];
  /** Prefixes (normalized the same way) after which the argument —
   *  e.g. a place name — is taken from the transcript. */
  argFrom?: string[];
}

const PATTERNS: PatternEntry[] = [
  // --- Hazards + Places FIRST: these patterns are specific and several
  // contain generic words ('describe the place' contains 'describe';
  // 'كرر وصف المكان' contains 'كرر'). The generic describe/read-text/
  // repeat entries below only match what is left over. ---
  {
    action: 'describe-place',
    patterns: ['كرر وصف المكان', 'وصف المكان', 'repeat the place description', 'describe the place'],
  },
  {
    action: 'sos',
    patterns: ['استغاثة', 'النجدة', 'sos', 'help me', 'emergency'],
  },
  {
    action: 'acknowledge-ok',
    patterns: ['انا بخير', 'أنا بخير', 'انا كويس', 'i am ok', "i'm okay", 'im okay'],
  },
  {
    action: 'save-place',
    patterns: [
      'احفظ المكان ده باسم', 'احفظ المكان باسم', 'سمي المكان ده', 'سمي المكان',
      'save this place as', 'save place as', 'name this place',
    ],
    argFrom: [
      'احفظ المكان ده باسم', 'احفظ المكان باسم', 'سمي المكان ده', 'سمي المكان',
      'save this place as', 'save place as', 'name this place',
    ],
  },
  {
    action: 'save-place-unnamed',
    patterns: ['احفظ المكان ده', 'احفظ المكان', 'save this place', 'save place'],
  },
  {
    action: 'delete-place',
    patterns: ['امسح المكان المحفوظ باسم', 'احذف المكان المحفوظ باسم', 'امسح المكان', 'احذف المكان', 'delete the saved place', 'delete place'],
    argFrom: ['امسح المكان المحفوظ باسم', 'احذف المكان المحفوظ باسم', 'delete the saved place', 'delete place', 'امسح المكان', 'احذف المكان'],
  },
  {
    action: 'add-place-note',
    patterns: ['ضيف ملاحظة للمكان', 'اضف ملاحظة للمكان', 'أضف ملاحظة للمكان', 'ضيف ملاحظة', 'add a note to the place', 'add note to the place', 'add a note'],
    argFrom: ['ضيف ملاحظة للمكان', 'اضف ملاحظة للمكان', 'أضف ملاحظة للمكان', 'add a note to the place', 'add note to the place'],
  },
  {
    action: 'list-places',
    patterns: [
      'ايه الاماكن اللي حفظتها', 'إيه الأماكن اللي حفظتها', 'الاماكن المحفوظة', 'الأماكن المحفوظة',
      'اماكني', 'what places have i saved', 'my places', 'list places', 'saved places',
    ],
  },
  {
    action: 'near-place',
    patterns: ['انا قريب من', 'أنا قريب من', 'قريب من', 'am i near', 'near'],
    argFrom: ['انا قريب من', 'أنا قريب من', 'قريب من', 'am i near', 'near'],
  },
  {
    action: 'find-place',
    patterns: ['فين', 'where is'],
    argFrom: ['فين', 'where is'],
  },
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

export function parseVoiceCommand(raw: string): ParsedCommand {
  const text = normalize(raw);
  for (const entry of PATTERNS) {
    for (const p of entry.patterns) {
      const np = normalize(p);
      if (text.includes(np)) {
        const reg = COMMAND_REGISTRY.find((c) => c.action === entry.action)!;
        let argument: string | undefined;
        if (entry.argFrom) {
          for (const prefix of entry.argFrom) {
            const npre = normalize(prefix);
            const idx = text.indexOf(npre);
            if (idx >= 0) {
              const rest = text.slice(idx + npre.length).trim();
              if (rest) argument = rest;
              break;
            }
          }
        }
        return { ...reg, argument };
      }
    }
  }
  return { action: 'unknown', implemented: false, exampleEn: '', exampleAr: '' };
}

/** Machine-readable voice failure kinds — the UI localizes these, so a
 * raw English native message never reaches an Arabic user (ROOT CAUSE 4). */
export type VoiceErrorKind =
  | 'permission'
  | 'unavailable'
  | 'language'
  | 'network'
  | 'no-match'
  | 'aborted'
  | 'audio'
  | 'unknown';

export class VoiceUnavailableError extends Error {
  readonly code = 'VOICE_UNAVAILABLE';
  readonly kind: 'permission' | 'unavailable';
  constructor(message: string, kind: 'permission' | 'unavailable' = 'unavailable') {
    super(message);
    this.name = 'VoiceUnavailableError';
    this.kind = kind;
  }
}

/** A recognition-session failure reported by the native recognizer. */
export class VoiceRecognitionError extends Error {
  readonly code = 'VOICE_RECOGNITION_ERROR';
  readonly kind: VoiceErrorKind;
  constructor(kind: VoiceErrorKind, message: string) {
    super(message);
    this.name = 'VoiceRecognitionError';
    this.kind = kind;
  }
}

/** Map a native expo-speech-recognition error code to a VoiceErrorKind. */
export function mapNativeErrorCode(code: string): VoiceErrorKind {
  switch (code) {
    case 'not-allowed':
      return 'permission';
    case 'service-not-allowed':
      return 'unavailable';
    case 'language-not-supported':
      return 'language';
    case 'network':
      return 'network';
    case 'no-speech':
    case 'no-match':
      return 'no-match';
    case 'audio-capture':
      return 'audio';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

/** i18n key for any voice failure — screens render THIS, never e.message. */
export function voiceErrorMessageKey(e: unknown): import('../i18n/strings').StringKey {
  const kind: VoiceErrorKind | null =
    e instanceof VoiceUnavailableError || e instanceof VoiceRecognitionError
      ? e.kind
      : null;
  switch (kind) {
    case 'permission':
      return 'voiceErrPermission';
    case 'unavailable':
      return 'voiceErrUnavailable';
    case 'language':
      return 'voiceErrLanguage';
    case 'network':
      return 'voiceErrNetwork';
    case 'no-match':
      return 'voiceErrNoMatch';
    default:
      return 'voiceErrGeneric';
  }
}

export interface VoiceCommandService {
  startListening(
    lang: 'ar' | 'en',
    onResult: (transcript: string) => void,
    onError: (e: Error) => void,
    onEnd?: () => void,
  ): Promise<void>;
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
    event: 'result' | 'error' | 'end' | 'nomatch',
    cb: ((ev: any) => void),
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
      'unavailable',
    );
  }
}

/** Thin wrapper over expo-speech-recognition's native module. */
export class NativeVoiceCommandService implements VoiceCommandService {
  private subscriptions: { remove(): void }[] = [];
  private module: SpeechModuleLike | null = null;
  /** True while a recognition session is live. Guards startListening
   *  idempotence: a second start while listening must not re-register
   *  listeners or call the native start() again. Reset by finish(),
   *  stopListening(), and any start failure. */
  private sessionActive = false;

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
    onEnd?: () => void,
  ): Promise<void> {
    // Idempotence: a session is already live — a duplicate start is a
    // no-op, never a second native start or a second listener set.
    if (this.sessionActive) return;
    this.sessionActive = true;
    try {
      const mod = loadSpeechModule();
      this.module = mod;

      const permission = await mod.requestPermissionsAsync();
      if (!permission.granted) {
        throw new VoiceUnavailableError(
          'Microphone permission was denied. BASERA needs microphone access for voice commands; you can grant it in system settings.',
          'permission',
        );
      }
      if (!mod.isRecognitionAvailable()) {
        throw new VoiceUnavailableError(
          'Speech recognition is not available on this device (no speech recognition service found). BASERA never assumes offline recognition support.',
          'unavailable',
        );
      }

      this.clearSubscriptions();

      // Session completion fires exactly once: final result, error,
      // 'nomatch', or the recognizer's own 'end' — the screen resets its
      // state from onEnd, so it can never get stuck on "listening".
      // Every handler is finished-guarded: after completion, a duplicate
      // final result / error / nomatch must not reach the callbacks.
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.sessionActive = false;
        onEnd?.();
      };
      this.subscriptions.push(
        mod.addListener('result', (ev: SpeechRecognitionResultEventLike) => {
          if (finished || !ev.isFinal) return;
          const transcript = ev.results?.[0]?.transcript?.trim();
          if (transcript) {
            onResult(transcript);
            finish();
          }
        }),
        mod.addListener('error', (ev: SpeechRecognitionErrorEventLike) => {
          if (finished) return;
          const kind = mapNativeErrorCode(ev.error ?? '');
          // 'aborted' = we (or the system) stopped listening on purpose:
          // a normal end of session, not a failure to report.
          if (kind === 'aborted') {
            finish();
            return;
          }
          onError(
            new VoiceRecognitionError(kind, ev.message || ev.error || 'Speech recognition error'),
          );
          finish();
        }),
        mod.addListener('nomatch', () => {
          if (finished) return;
          onError(new VoiceRecognitionError('no-match', 'No speech matched.'));
          finish();
        }),
        mod.addListener('end', finish),
      );

      mod.start({
        lang: lang === 'ar' ? 'ar-EG' : 'en-US',
        interimResults: false,
        maxAlternatives: 1,
      });
    } catch (e) {
      // Error recovery: no half-registered session may survive a failed
      // start (module load, permission, availability, or native start)
      // — drop the listeners and allow an immediate retry.
      this.sessionActive = false;
      this.clearSubscriptions();
      throw e;
    }
  }

  async stopListening(): Promise<void> {
    this.sessionActive = false;
    try {
      this.module?.stop();
    } catch {
      // Recognizer already stopped — stopping is a no-op.
    }
    this.clearSubscriptions();
  }
}
