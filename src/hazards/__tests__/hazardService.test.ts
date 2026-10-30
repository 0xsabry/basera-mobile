/**
 * HazardService orchestration tests with fake notifier + in-memory
 * store: alert delivery rules, honest SOS outcomes, acknowledgment.
 */
import { AlertHistoryStore, type AlertStorage } from '../AlertHistoryStore';
import {
  acknowledgeHazards,
  configureHazardRuntime,
  processHazardDetections,
  resetHazardRuntimeForTests,
  triggerSos,
  type GuardianNotifyOutcome,
} from '../HazardService';
import { RiskEngine } from '../RiskEngine';
import { setHapticsEnabled } from '../../state/haptics';
import type { Detection } from '../../ai/types';

const mockSpeakAlert = jest.fn(async (_text: string, _lang: string) => undefined);
const mockSpeakAnnouncement = jest.fn(async (_text: string, _lang: string) => undefined);
jest.mock('../../ai/SpeechService', () => ({
  speechService: {
    speakAlert: (text: string, lang: string) => mockSpeakAlert(text, lang),
    speakAnnouncement: (text: string, lang: string) => mockSpeakAnnouncement(text, lang),
    setRate: () => undefined,
  },
}));

function memoryStorage(): AlertStorage {
  let value: string | null = null;
  return {
    getItem: async () => value,
    setItem: async (_k, v) => {
      value = v;
    },
  };
}

const carNearCenter = (): Detection => ({
  labelEn: 'car',
  labelAr: 'سيارة',
  classId: 2,
  confidence: 0.9,
  box: { x: 0.25, y: 0.3, width: 0.5, height: 0.5 },
});

function setup(notifyOutcome: GuardianNotifyOutcome, sharingOn = false) {
  const store = new AlertHistoryStore(memoryStorage());
  const notifier = { notify: jest.fn(async () => notifyOutcome) };
  configureHazardRuntime({
    engine: new RiskEngine({ now: () => 5000 }),
    store: store as never,
    notifier,
    isSharingOn: () => sharingOn,
  });
  return { store, notifier };
}

beforeEach(() => {
  jest.clearAllMocks();
  setHapticsEnabled(false); // keep the platform Vibration out of tests
  resetHazardRuntimeForTests();
});
afterAll(() => setHapticsEnabled(true));

describe('processHazardDetections', () => {
  it('first sighting does not alert or record (persistence)', async () => {
    const { store } = setup('sent');
    const r = await processHazardDetections([carNearCenter()], 'en');
    expect(r.alerts).toHaveLength(0);
    expect(await store.list()).toHaveLength(0);
  });

  it('persistent high hazard: alert spoken on alert channel, event recorded, guardian notified', async () => {
    const { store, notifier } = setup('sent', true);
    await processHazardDetections([carNearCenter()], 'en');
    const r = await processHazardDetections([carNearCenter()], 'en');
    expect(r.alerts).toHaveLength(1);
    expect(mockSpeakAlert).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    const events = await store.list();
    expect(events).toHaveLength(1);
    expect(events[0].guardianNotify).toBe('sent');
    expect(events[0].locationShared).toBe(true);
    expect(events[0].acknowledged).toBe(false);
  });

  it('when the guardian service is unavailable the event records it — never "sent"', async () => {
    const { store } = setup('unavailable');
    await processHazardDetections([carNearCenter()], 'ar');
    await processHazardDetections([carNearCenter()], 'ar');
    const events = await store.list();
    expect(events[0].guardianNotify).toBe('unavailable');
  });
});

describe('triggerSos — honest outcomes', () => {
  it('sent: message says notification was sent but delivery is not guaranteed', async () => {
    setup('sent');
    const out = await triggerSos('en');
    expect(out.notify).toBe('sent');
    expect(out.message).toContain('not guaranteed');
    expect(out.event.kind).toBe('sos');
  });

  it('unavailable: message states guardians were NOT notified', async () => {
    setup('unavailable');
    const out = await triggerSos('en');
    expect(out.notify).toBe('unavailable');
    expect(out.message).toContain('NOT notified');
  });

  it('failed: message states guardians may NOT have been notified', async () => {
    const { store } = setup('failed');
    const out = await triggerSos('ar');
    expect(out.notify).toBe('failed');
    expect(out.message).toContain('لم يتم إبلاغهم');
    expect((await store.list())[0].guardianNotify).toBe('failed');
  });
});

describe('acknowledgeHazards', () => {
  it('marks all stored events acknowledged', async () => {
    const { store } = setup('sent');
    await triggerSos('en');
    await acknowledgeHazards();
    expect((await store.list())[0].acknowledged).toBe(true);
  });
});
