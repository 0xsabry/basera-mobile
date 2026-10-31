/**
 * Repeat-mechanism tests (ROOT CAUSE 3): the onboarding welcome used to
 * become the repeat target because speak() recorded EVERY utterance.
 * Now only meaningful responses are repeatable.
 */
import { ExpoSpeechService } from '../SpeechService';

const mockSpeak = jest.fn();
const mockStop = jest.fn(async () => undefined);

jest.mock('expo-speech', () => ({
  speak: (...args: unknown[]) => mockSpeak(...args),
  stop: () => mockStop(),
  isSpeakingAsync: async () => false,
}));

const WELCOME_AR = 'أهلاً بك في بصيرة. اختار اللي تحب تعمله من الشاشة الرئيسية.';
const DESCRIPTION_AR = 'فيه شخص قدامك وكرسي على الشمال.';

describe('SpeechService repeat semantics', () => {
  beforeEach(() => {
    mockSpeak.mockClear();
    mockStop.mockClear();
  });

  it('welcome (announcement) then repeat -> nothing-to-repeat message, welcome NOT replayed', async () => {
    const svc = new ExpoSpeechService();
    await svc.speakAnnouncement(WELCOME_AR, 'ar');
    expect(svc.lastText).toBeNull();
    mockSpeak.mockClear();
    await svc.repeatLast();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    const [text, opts] = mockSpeak.mock.calls[0];
    expect(text).toBe('لا يوجد ما يمكن تكراره بعد.');
    expect(text).not.toContain('أهلاً بك');
    expect(opts.language).toBe('ar-EG');
    // And the nothing-to-repeat message must not itself become repeatable.
    expect(svc.lastText).toBeNull();
  });

  it('description then welcome then repeat -> repeats the DESCRIPTION', async () => {
    const svc = new ExpoSpeechService();
    await svc.speak(DESCRIPTION_AR, 'ar');
    await svc.speakAnnouncement(WELCOME_AR, 'ar');
    expect(svc.lastText).toBe(DESCRIPTION_AR);
    mockSpeak.mockClear();
    await svc.repeatLast();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe(DESCRIPTION_AR);
    expect(mockSpeak.mock.calls[0][1].language).toBe('ar-EG');
  });

  it('repeat preserves the language of the original response (en)', async () => {
    const svc = new ExpoSpeechService();
    await svc.speak('There is a chair in front of you.', 'en');
    mockSpeak.mockClear();
    await svc.repeatLast();
    expect(mockSpeak.mock.calls[0][0]).toBe('There is a chair in front of you.');
    expect(mockSpeak.mock.calls[0][1].language).toBe('en-US');
  });

  it('announcements do not change lastText but are actually spoken', async () => {
    const svc = new ExpoSpeechService();
    await svc.speak(DESCRIPTION_AR, 'ar');
    mockSpeak.mockClear();
    await svc.speakAnnouncement('تم تغيير اللغة إلى العربية', 'ar');
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(svc.lastText).toBe(DESCRIPTION_AR);
  });

  it('alert target is separate: speakAlert does not clobber the response repeat target', async () => {
    const svc = new ExpoSpeechService();
    await svc.speak(DESCRIPTION_AR, 'ar');
    await svc.speakAlert('احذر! عربية قريبة منك في المنتصف.', 'ar');
    expect(svc.lastAlertText).toBe('احذر! عربية قريبة منك في المنتصف.');
    expect(svc.lastText).toBe(DESCRIPTION_AR);
    mockSpeak.mockClear();
    await svc.repeatAlert();
    expect(mockSpeak.mock.calls[0][0]).toBe('احذر! عربية قريبة منك في المنتصف.');
    mockSpeak.mockClear();
    await svc.repeatLast();
    expect(mockSpeak.mock.calls[0][0]).toBe(DESCRIPTION_AR);
  });

  it('speechEnabled=false suppresses ALL output (speak, announcement, alert)', async () => {
    const svc = new ExpoSpeechService();
    svc.setSpeechEnabled(false);
    await svc.speak('hello', 'en');
    await svc.speakAnnouncement('hello', 'en');
    await svc.speakAlert('warning', 'en');
    expect(mockSpeak).not.toHaveBeenCalled();
    svc.setSpeechEnabled(true);
    await svc.speak('hello again', 'en');
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });

  it('chosen voice identifier is passed through to the TTS call', async () => {
    const svc = new ExpoSpeechService();
    svc.setVoiceIdentifier('ar-voice-1');
    await svc.speak('مرحبا', 'ar');
    expect(mockSpeak.mock.calls[0][1].voice).toBe('ar-voice-1');
    svc.setVoiceIdentifier(null);
    mockSpeak.mockClear();
    await svc.speak('مرحبا', 'ar');
    expect(mockSpeak.mock.calls[0][1].voice).toBeUndefined();
  });
});
