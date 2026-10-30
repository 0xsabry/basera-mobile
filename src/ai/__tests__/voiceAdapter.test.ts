/**
 * Adapter tests for NativeVoiceCommandService on expo-speech-recognition.
 * The native module is mocked; the parser integration uses the REAL parser.
 * Nothing here claims microphone/hardware verification.
 */
import {
  NativeVoiceCommandService,
  VoiceUnavailableError,
  parseVoiceCommand,
} from '../VoiceCommandService';

type Listener = (ev: never) => void;

const mockModule = {
  granted: true,
  available: true,
  listeners: new Map<string, Listener[]>(),
  startedWith: null as null | { lang: string },
  stopped: false,
  async requestPermissionsAsync() {
    return { granted: this.granted };
  },
  isRecognitionAvailable() {
    return this.available;
  },
  start(options: { lang: string }) {
    this.startedWith = options;
  },
  stop() {
    this.stopped = true;
  },
  addListener(event: string, cb: Listener) {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
    return {
      remove: () => {
        const cur = this.listeners.get(event) ?? [];
        this.listeners.set(
          event,
          cur.filter((l) => l !== cb),
        );
      },
    };
  },
  emit(event: string, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) {
      (cb as (ev: unknown) => void)(payload);
    }
  },
  reset() {
    this.granted = true;
    this.available = true;
    this.listeners.clear();
    this.startedWith = null;
    this.stopped = false;
  },
};

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: mockModule,
}));

describe('NativeVoiceCommandService (expo-speech-recognition adapter)', () => {
  beforeEach(() => mockModule.reset());

  it('requests permission, checks availability, starts with ar-EG for Arabic', async () => {
    const svc = new NativeVoiceCommandService();
    await svc.startListening('ar', jest.fn(), jest.fn());
    expect(mockModule.startedWith?.lang).toBe('ar-EG');
  });

  it('starts with en-US for English', async () => {
    const svc = new NativeVoiceCommandService();
    await svc.startListening('en', jest.fn(), jest.fn());
    expect(mockModule.startedWith?.lang).toBe('en-US');
  });

  it('permission denied -> VoiceUnavailableError, recognizer never starts', async () => {
    mockModule.granted = false;
    const svc = new NativeVoiceCommandService();
    await expect(svc.startListening('en', jest.fn(), jest.fn())).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
    expect(mockModule.startedWith).toBeNull();
  });

  it('recognition unavailable on device -> VoiceUnavailableError', async () => {
    mockModule.available = false;
    const svc = new NativeVoiceCommandService();
    await expect(svc.startListening('ar', jest.fn(), jest.fn())).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
    expect(mockModule.startedWith).toBeNull();
  });

  it('final result event delivers the transcript; interim results are ignored', async () => {
    const svc = new NativeVoiceCommandService();
    const onResult = jest.fn();
    await svc.startListening('en', onResult, jest.fn());
    mockModule.emit('result', { isFinal: false, results: [{ transcript: 'what is' }] });
    expect(onResult).not.toHaveBeenCalled();
    mockModule.emit('result', {
      isFinal: true,
      results: [{ transcript: 'What is in front of me?' }],
    });
    expect(onResult).toHaveBeenCalledWith('What is in front of me?');
    // And the real parser turns it into the describe command.
    expect(parseVoiceCommand(onResult.mock.calls[0][0]).action).toBe('describe');
  });

  it('Arabic final result flows into the parser as read-text', async () => {
    const svc = new NativeVoiceCommandService();
    const onResult = jest.fn();
    await svc.startListening('ar', onResult, jest.fn());
    mockModule.emit('result', { isFinal: true, results: [{ transcript: 'اقرأ النص' }] });
    expect(parseVoiceCommand(onResult.mock.calls[0][0]).action).toBe('read-text');
  });

  it('error event is surfaced through onError', async () => {
    const svc = new NativeVoiceCommandService();
    const onError = jest.fn();
    await svc.startListening('en', jest.fn(), onError);
    mockModule.emit('error', { error: 'network', message: 'Network error' });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Network error' }));
  });

  it('stopListening stops the recognizer and removes listeners', async () => {
    const svc = new NativeVoiceCommandService();
    const onResult = jest.fn();
    await svc.startListening('en', onResult, jest.fn());
    await svc.stopListening();
    expect(mockModule.stopped).toBe(true);
    mockModule.emit('result', { isFinal: true, results: [{ transcript: 'repeat' }] });
    expect(onResult).not.toHaveBeenCalled();
  });
});
