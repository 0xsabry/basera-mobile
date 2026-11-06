/**
 * Latency contract for narration (owner report: "the voice takes
 * time to tell"):
 * 1. A cold voice catalog gets only a short bounded wait (300 ms):
 *    a hung discovery must not block an Arabic utterance — the
 *    ar-EG language fallback speaks, and the discovered voice
 *    applies from the next utterance.
 * 2. When nothing is playing, utter() must not pay the
 *    Speech.stop() round-trip; when an utterance IS playing, the
 *    next one still stops it first (interruption semantics).
 * 3. warmUp() starts discovery without speaking.
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

const EG_VOICE = [{ identifier: 'eg-voice', language: 'ar_EG', name: 'Egyptian', quality: 'Enhanced' }];

describe('SpeechService latency', () => {
  beforeEach(() => {
    mockSpeak.mockReset();
    mockStop.mockClear();
    mockGetVoices.mockReset();
    mockGetVoices.mockResolvedValue([]);
    mockSpeak.mockImplementation((_text: string, opts: { onDone?: () => void }) => {
      opts.onDone?.();
    });
  });

  it('cold catalog: Arabic speak waits at most the bounded window for discovery', async () => {
    let resolveVoices: (v: unknown[]) => void = () => undefined;
    mockGetVoices.mockImplementation(
      () => new Promise<unknown[]>((res) => { resolveVoices = res; }),
    );
    const svc = new ExpoSpeechService();
    // Discovery is still pending, yet the utterance must be issued.
    await svc.speak('فيه كرسي قدامك', 'ar');
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    const [, opts] = mockSpeak.mock.calls[0];
    expect(opts.language).toBe('ar-EG');
    expect(opts.voice).toBeUndefined();
    // Once discovery lands, the NEXT utterance uses the Egyptian voice.
    resolveVoices(EG_VOICE);
    await new Promise((r) => setTimeout(r, 0));
    await svc.speak('فيه باب مفتوح', 'ar');
    const [, opts2] = mockSpeak.mock.calls[1];
    expect(opts2.voice).toBe('eg-voice');
  });

  it('idle utterances skip Speech.stop(); a playing utterance is still interrupted', async () => {
    const svc = new ExpoSpeechService();
    // First speak completes (mock fires onDone) → service is idle.
    await svc.speak('one', 'en');
    expect(mockStop).not.toHaveBeenCalled();
    // Second speak while the first is still "playing" (no onDone):
    mockSpeak.mockImplementation(() => undefined);
    await svc.speak('two', 'en');
    expect(mockStop).not.toHaveBeenCalled();
    // Third speak must stop the still-playing second one first.
    await svc.speak('three', 'en');
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('warmUp starts discovery and speaks nothing', async () => {
    const svc = new ExpoSpeechService();
    svc.warmUp();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockGetVoices).toHaveBeenCalled();
    expect(mockSpeak).not.toHaveBeenCalled();
  });
});
