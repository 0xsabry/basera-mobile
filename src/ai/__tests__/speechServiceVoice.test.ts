/**
 * Bug 4: testSpeak audition + stale-voice guard.
 * Follows the mocking pattern of speechService.test.ts (jest.mock of
 * expo-speech with controllable speak/stop).
 */
import { ExpoSpeechService } from '../SpeechService';

const mockSpeak = jest.fn();
const mockStop = jest.fn(async () => undefined);

jest.mock('expo-speech', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: () => mockStop(),
  isSpeakingAsync: async () => false,
}));

describe('SpeechService voice test + selection validation (Bug 4)', () => {
  beforeEach(() => {
    mockSpeak.mockReset();
    mockStop.mockClear();
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
    expect(text).toBe('مرحبًا، هذا اختبار للصوت.');
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
    svc.setVoiceIdentifier('persisted-voice');
    await svc.testSpeak('other-voice', 'en');
    expect(mockSpeak.mock.calls[0][1].voice).toBe('other-voice');
  });

  it('validateVoiceSelection clears an unknown identifier and reports false', async () => {
    mockSpeak.mockImplementation(() => undefined);
    const svc = new ExpoSpeechService();
    svc.setVoiceIdentifier('stale-voice');
    expect(svc.validateVoiceSelection(new Set(['real-voice']))).toBe(false);
    // Cleared: a later utterance carries no voice override at all.
    await svc.speak('hello', 'en');
    expect(mockSpeak.mock.calls[0][1].voice).toBeUndefined();
  });

  it('validateVoiceSelection keeps a known identifier and reports true', async () => {
    mockSpeak.mockImplementation(() => undefined);
    const svc = new ExpoSpeechService();
    svc.setVoiceIdentifier('real-voice');
    expect(svc.validateVoiceSelection(new Set(['real-voice', 'other']))).toBe(true);
    await svc.speak('hello', 'en');
    expect(mockSpeak.mock.calls[0][1].voice).toBe('real-voice');
  });

  it('validateVoiceSelection leaves a null selection null and reports true', () => {
    const svc = new ExpoSpeechService();
    expect(svc.validateVoiceSelection(new Set(['anything']))).toBe(true);
    expect(svc.validateVoiceSelection(new Set())).toBe(true);
  });
});
