/**
 * Bug 4: testSpeak audition + stale-voice guard.
 * Follows the mocking pattern of speechService.test.ts (jest.mock of
 * expo-speech with controllable speak/stop).
 */
import { ExpoSpeechService } from '../SpeechService';

const mockSpeak = jest.fn();
const mockStop = jest.fn(async () => undefined);
const mockGetVoices = jest.fn(async () => [] as unknown[]);

jest.mock('expo-speech', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: () => mockStop(),
  isSpeakingAsync: async () => false,
  getAvailableVoicesAsync: () => mockGetVoices(),
}));

describe('SpeechService voice test + selection validation (Bug 4)', () => {
  beforeEach(() => {
    mockSpeak.mockReset();
    mockStop.mockClear();
    mockGetVoices.mockReset();
    mockGetVoices.mockResolvedValue([]);
  });

  it('testSpeak resolves true when the utterance finishes (onDone)', async () => {
    mockSpeak.mockImplementation((_text: string, opts: { onDone?: () => void }) => {
      opts.onDone?.();
    });
    const svc = new ExpoSpeechService();
    await expect(svc.testSpeak('voice-1', 'en')).resolves.toBe(true);
    const [text, opts] = mockSpeak.mock.calls[0];
    expect(text).toBe('Hello, this is a voice test.');
    expect(opts.voice).toBe('voice-1');
    expect(opts.language).toBe('en-US');
  });

  it('testSpeak speaks the Arabic sample for an Arabic voice, with no voice for default', async () => {
    mockSpeak.mockImplementation((_text: string, opts: { onDone?: () => void }) => {
      opts.onDone?.();
    });
    const svc = new ExpoSpeechService();
    await expect(svc.testSpeak(null, 'ar')).resolves.toBe(true);
    const [text, opts] = mockSpeak.mock.calls[0];
    expect(text).toBe('أهلاً بيك، أنا بصيرة. هساعدك تعرف اللي حواليك خطوة بخطوة.');
    expect(opts.language).toBe('ar-EG');
    expect(opts.voice).toBeUndefined();
  });

  it('testSpeak resolves false on onError', async () => {
    mockSpeak.mockImplementation((_text: string, opts: { onError?: () => void }) => {
      opts.onError?.();
    });
    const svc = new ExpoSpeechService();
    await expect(svc.testSpeak('missing-voice', 'ar')).resolves.toBe(false);
  });

  it('testSpeak resolves false on a synchronous engine throw', async () => {
    mockSpeak.mockImplementation(() => {
      throw new Error('no engine');
    });
    const svc = new ExpoSpeechService();
    await expect(svc.testSpeak('voice-1', 'en')).resolves.toBe(false);
  });

  it('testSpeak resolves false and stays silent when the speech gate is off', async () => {
    const svc = new ExpoSpeechService();
    svc.setSpeechEnabled(false);
    await expect(svc.testSpeak('voice-1', 'en')).resolves.toBe(false);
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('testSpeak does not clobber the repeat target', async () => {
    mockSpeak.mockImplementation((_text: string, opts: { onDone?: () => void }) => {
      opts.onDone?.();
    });
    const svc = new ExpoSpeechService();
    await svc.speak('A meaningful description.', 'en');
    expect(svc.lastText).toBe('A meaningful description.');
    await svc.testSpeak('voice-9', 'en');
    expect(svc.lastText).toBe('A meaningful description.');
    expect(svc.lastAlertText).toBeNull();
  });

  it('testSpeak uses the given voice, not the persisted selection', async () => {
    mockSpeak.mockImplementation((_text: string, opts: { onDone?: () => void }) => {
      opts.onDone?.();
    });
    const svc = new ExpoSpeechService();
    svc.setVoicePreference({ kind: 'custom', identifier: 'persisted-voice' });
    await svc.testSpeak('other-voice', 'en');
    expect(mockSpeak.mock.calls[0][1].voice).toBe('other-voice');
  });

  it('validateVoiceSelection resets a stale custom identifier to auto and reports false', async () => {
    mockSpeak.mockImplementation(() => undefined);
    const svc = new ExpoSpeechService();
    svc.setVoicePreference({ kind: 'custom', identifier: 'stale-voice' });
    expect(svc.validateVoiceSelection(new Set(['real-voice']))).toBe(false);
    // Reset to auto: a later English utterance carries no voice at all.
    await svc.speak('hello', 'en');
    expect(mockSpeak.mock.calls[0][1].voice).toBeUndefined();
  });

  it('validateVoiceSelection keeps a known custom identifier and reports true', async () => {
    mockSpeak.mockImplementation(() => undefined);
    const svc = new ExpoSpeechService();
    svc.setVoicePreference({ kind: 'custom', identifier: 'real-voice' });
    expect(svc.validateVoiceSelection(new Set(['real-voice', 'other']))).toBe(true);
    await svc.speak('hello', 'en');
    expect(mockSpeak.mock.calls[0][1].voice).toBe('real-voice');
  });

  it('validateVoiceSelection never touches auto or explicit system preferences', () => {
    const svc = new ExpoSpeechService();
    expect(svc.validateVoiceSelection(new Set(['anything']))).toBe(true);
    expect(svc.validateVoiceSelection(new Set())).toBe(true);
    svc.setVoicePreference({ kind: 'system' });
    expect(svc.validateVoiceSelection(new Set())).toBe(true);
  });
});

describe('SpeechService automatic Egyptian voice (auto preference)', () => {
  beforeEach(() => {
    mockSpeak.mockReset();
    mockStop.mockClear();
    mockGetVoices.mockReset();
    mockSpeak.mockImplementation(() => undefined);
  });

  it('Arabic speech uses the exact ar-EG voice (Enhanced) discovered at runtime', async () => {
    mockGetVoices.mockResolvedValue([
      { identifier: 'sa-enhanced', name: 'Saudi', language: 'ar-SA', quality: 'Enhanced' },
      { identifier: 'eg-default', name: 'Egypt Default', language: 'ar-EG', quality: 'Default' },
      { identifier: 'eg-enhanced', name: 'Egypt Enhanced', language: 'ar_EG', quality: 'Enhanced' },
    ]);
    const svc = new ExpoSpeechService(); // default preference is auto
    await svc.speak('مرحبا', 'ar');
    const [, opts] = mockSpeak.mock.calls[0];
    expect(opts.voice).toBe('eg-enhanced');
    expect(opts.language).toBe('ar-EG');
  });

  it('no exact Egyptian voice: Arabic still speaks, with the ar-EG language tag and no voice', async () => {
    mockGetVoices.mockResolvedValue([
      { identifier: 'sa-1', name: 'Saudi', language: 'ar-SA', quality: 'Enhanced' },
      { identifier: 'xa-1', name: 'Generic', language: 'ar-XA', quality: 'Enhanced' },
    ]);
    const svc = new ExpoSpeechService();
    await svc.speak('مرحبا', 'ar');
    const [, opts] = mockSpeak.mock.calls[0];
    expect(opts.voice).toBeUndefined();
    expect(opts.language).toBe('ar-EG');
  });

  it('voice discovery failure never blocks speech', async () => {
    mockGetVoices.mockRejectedValue(new Error('engine gone'));
    const svc = new ExpoSpeechService();
    await expect(svc.speak('مرحبا', 'ar')).resolves.toBeUndefined();
    expect(mockSpeak.mock.calls[0][1].voice).toBeUndefined();
    expect(mockSpeak.mock.calls[0][1].language).toBe('ar-EG');
  });

  it('auto does not change English behavior (no voice passed)', async () => {
    mockGetVoices.mockResolvedValue([
      { identifier: 'eg-enhanced', name: 'Egypt Enhanced', language: 'ar-EG', quality: 'Enhanced' },
    ]);
    const svc = new ExpoSpeechService();
    await svc.speak('hello', 'en');
    expect(mockSpeak.mock.calls[0][1].voice).toBeUndefined();
    expect(mockSpeak.mock.calls[0][1].language).toBe('en-US');
  });

  it('explicit system preference survives: Arabic speaks with no voice even when an Egyptian voice exists', async () => {
    mockGetVoices.mockResolvedValue([
      { identifier: 'eg-enhanced', name: 'Egypt Enhanced', language: 'ar-EG', quality: 'Enhanced' },
    ]);
    const svc = new ExpoSpeechService();
    svc.setVoicePreference({ kind: 'system' });
    await svc.speak('مرحبا', 'ar');
    expect(mockSpeak.mock.calls[0][1].voice).toBeUndefined();
  });

  it('picker-fed catalog (noteAvailableVoices) is used without a second discovery', async () => {
    mockGetVoices.mockRejectedValue(new Error('must not be called'));
    const svc = new ExpoSpeechService();
    svc.noteAvailableVoices([
      { identifier: 'eg-1', name: 'Egypt', language: 'ar-EG', quality: 'Default' },
    ]);
    await svc.speak('مرحبا', 'ar');
    expect(mockSpeak.mock.calls[0][1].voice).toBe('eg-1');
    expect(mockGetVoices).not.toHaveBeenCalled();
  });
});
