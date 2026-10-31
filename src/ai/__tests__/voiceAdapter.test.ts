/**
 * Adapter tests for NativeVoiceCommandService on expo-speech-recognition.
 * The native module is mocked; the parser integration uses the REAL parser.
 * Nothing here claims microphone/hardware verification.
 */
import {
  NativeVoiceCommandService,
  VoiceRecognitionError,
  VoiceUnavailableError,
  mapNativeErrorCode,
  parseVoiceCommand,
  voiceErrorMessageKey,
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

  it("'end' event completes the session via onEnd (screen never stuck listening)", async () => {
    const svc = new NativeVoiceCommandService();
    const onEnd = jest.fn();
    await svc.startListening('en', jest.fn(), jest.fn(), onEnd);
    mockModule.emit('end', {});
    expect(onEnd).toHaveBeenCalledTimes(1);
    // A second end (or a trailing event) must not fire it again.
    mockModule.emit('end', {});
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('final result also completes the session exactly once', async () => {
    const svc = new NativeVoiceCommandService();
    const onEnd = jest.fn();
    await svc.startListening('en', jest.fn(), jest.fn(), onEnd);
    mockModule.emit('result', { isFinal: true, results: [{ transcript: 'repeat' }] });
    mockModule.emit('end', {});
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("'nomatch' completes with a typed no-match error", async () => {
    const svc = new NativeVoiceCommandService();
    const onError = jest.fn();
    const onEnd = jest.fn();
    await svc.startListening('en', jest.fn(), onError, onEnd);
    mockModule.emit('nomatch', {});
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'no-match' }),
    );
    expect(onError.mock.calls[0][0]).toBeInstanceOf(VoiceRecognitionError);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('error codes map to typed kinds and localization keys', () => {
    expect(mapNativeErrorCode('not-allowed')).toBe('permission');
    expect(mapNativeErrorCode('service-not-allowed')).toBe('unavailable');
    expect(mapNativeErrorCode('language-not-supported')).toBe('language');
    expect(mapNativeErrorCode('network')).toBe('network');
    expect(mapNativeErrorCode('no-speech')).toBe('no-match');
    expect(mapNativeErrorCode('audio-capture')).toBe('audio');
    expect(mapNativeErrorCode('aborted')).toBe('aborted');
    expect(mapNativeErrorCode('something-else')).toBe('unknown');

    expect(voiceErrorMessageKey(new VoiceRecognitionError('permission', 'x'))).toBe('voiceErrPermission');
    expect(voiceErrorMessageKey(new VoiceRecognitionError('unavailable', 'x'))).toBe('voiceErrUnavailable');
    expect(voiceErrorMessageKey(new VoiceRecognitionError('language', 'x'))).toBe('voiceErrLanguage');
    expect(voiceErrorMessageKey(new VoiceRecognitionError('network', 'x'))).toBe('voiceErrNetwork');
    expect(voiceErrorMessageKey(new VoiceRecognitionError('no-match', 'x'))).toBe('voiceErrNoMatch');
    expect(voiceErrorMessageKey(new VoiceRecognitionError('audio', 'x'))).toBe('voiceErrGeneric');
    expect(voiceErrorMessageKey(new VoiceUnavailableError('x', 'permission'))).toBe('voiceErrPermission');
    expect(voiceErrorMessageKey(new VoiceUnavailableError('x'))).toBe('voiceErrUnavailable');
    expect(voiceErrorMessageKey(new Error('raw'))).toBe('voiceErrGeneric');
  });

  it('error event carries the typed kind (network), not just a message', async () => {
    const svc = new NativeVoiceCommandService();
    const onError = jest.fn();
    const onEnd = jest.fn();
    await svc.startListening('en', jest.fn(), onError, onEnd);
    mockModule.emit('error', { error: 'network', message: 'Network error' });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'network', message: 'Network error' }),
    );
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("'aborted' error ends the session WITHOUT surfacing an error", async () => {
    const svc = new NativeVoiceCommandService();
    const onError = jest.fn();
    const onEnd = jest.fn();
    await svc.startListening('en', jest.fn(), onError, onEnd);
    mockModule.emit('error', { error: 'aborted', message: 'Aborted' });
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('permission-denied error carries kind=permission for localization', async () => {
    mockModule.granted = false;
    const svc = new NativeVoiceCommandService();
    const err = await svc.startListening('en', jest.fn(), jest.fn()).catch((e) => e);
    expect(err).toBeInstanceOf(VoiceUnavailableError);
    expect(err.kind).toBe('permission');
    expect(voiceErrorMessageKey(err)).toBe('voiceErrPermission');
  });

  it('startListening is idempotent: a second start while a session is active is a no-op', async () => {
    const svc = new NativeVoiceCommandService();
    const startSpy = jest.spyOn(mockModule, 'start');
    await svc.startListening('en', jest.fn(), jest.fn());
    await svc.startListening('en', jest.fn(), jest.fn());
    expect(startSpy).toHaveBeenCalledTimes(1);
    startSpy.mockRestore();
    await svc.stopListening();
  });

  it('a duplicate final result is delivered only once (session is finished-guarded)', async () => {
    const svc = new NativeVoiceCommandService();
    const onResult = jest.fn();
    await svc.startListening('en', onResult, jest.fn());
    mockModule.emit('result', { isFinal: true, results: [{ transcript: 'repeat' }] });
    mockModule.emit('result', { isFinal: true, results: [{ transcript: 'repeat' }] });
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('when native start throws, subscriptions are cleaned up and a retry can start', async () => {
    const svc = new NativeVoiceCommandService();
    const onResult = jest.fn();
    const originalStart = mockModule.start;
    mockModule.start = () => {
      throw new Error('recognizer busy');
    };
    await expect(svc.startListening('en', onResult, jest.fn())).rejects.toThrow('recognizer busy');
    // No stale listeners may survive the failed start.
    mockModule.emit('result', { isFinal: true, results: [{ transcript: 'repeat' }] });
    expect(onResult).not.toHaveBeenCalled();
    // Error recovery: a fresh start works after the failure.
    mockModule.start = originalStart;
    await svc.startListening('en', onResult, jest.fn());
    mockModule.emit('result', { isFinal: true, results: [{ transcript: 'repeat' }] });
    expect(onResult).toHaveBeenCalledTimes(1);
    await svc.stopListening();
  });

  it('stopListening is idempotent (double stop does not throw)', async () => {
    const svc = new NativeVoiceCommandService();
    await svc.startListening('en', jest.fn(), jest.fn());
    await svc.stopListening();
    await expect(svc.stopListening()).resolves.toBeUndefined();
    expect(mockModule.stopped).toBe(true);
  });

  it('after stopListening, late end/error events reach no callbacks', async () => {
    const svc = new NativeVoiceCommandService();
    const onError = jest.fn();
    const onEnd = jest.fn();
    await svc.startListening('en', jest.fn(), onError, onEnd);
    await svc.stopListening();
    mockModule.emit('end', {});
    mockModule.emit('error', { error: 'network', message: 'Network error' });
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
