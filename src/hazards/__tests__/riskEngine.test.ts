import type { Detection } from '../../ai/types';
import { extractCandidates, RiskEngine } from '../RiskEngine';

function det(labelEn: string, confidence: number, x: number, y: number, w: number, h: number): Detection {
  return { labelEn, labelAr: labelEn, classId: 0, confidence, box: { x, y, width: w, height: h } };
}
// Boxes: near = area >= .18, medium = .04.. .18, far < .04. cx .3-.7 = center.
const carNearCenter = () => det('car', 0.9, 0.25, 0.3, 0.5, 0.5);
const carMediumCenter = () => det('car', 0.9, 0.37, 0.4, 0.26, 0.26);
const carFar = () => det('car', 0.9, 0.45, 0.45, 0.1, 0.1);
const personNearCenter = () => det('person', 0.9, 0.3, 0.2, 0.4, 0.6);
const knifeNear = () => det('knife', 0.7, 0.3, 0.3, 0.5, 0.4);
const chairNear = () => det('chair', 0.95, 0.25, 0.3, 0.5, 0.5);

describe('extractCandidates — thresholds and levels', () => {
  it('drops below-threshold detections per category', () => {
    expect(extractCandidates([det('car', 0.3, 0.25, 0.3, 0.5, 0.5)])).toHaveLength(0);
    expect(extractCandidates([det('knife', 0.5, 0.3, 0.3, 0.5, 0.4)])).toHaveLength(0); // sharp threshold is 0.55
  });

  it('ignores non-hazard COCO classes entirely', () => {
    expect(extractCandidates([det('banana', 0.99, 0.25, 0.3, 0.5, 0.5)])).toHaveLength(0);
  });

  it('vehicle near = high; medium+center = high; far = low', () => {
    expect(extractCandidates([carNearCenter()])[0].level).toBe('high');
    expect(extractCandidates([carMediumCenter()])[0].level).toBe('high');
    expect(extractCandidates([carFar()])[0].level).toBe('low');
  });

  it('person is NEVER high — near+center caps at medium', () => {
    const c = extractCandidates([personNearCenter()])[0];
    expect(c.level).toBe('medium');
    expect(extractCandidates([det('person', 0.9, 0.45, 0.45, 0.1, 0.1)])[0].level).toBe('low');
  });

  it('sharp near = medium; static obstacle = low even when near', () => {
    expect(extractCandidates([knifeNear()])[0].level).toBe('medium');
    expect(extractCandidates([chairNear()])[0].level).toBe('low');
  });
});

describe('RiskEngine — persistence, cooldown, escalation', () => {
  it('a single-frame hazard does NOT alert (persistence 2-of-3)', () => {
    const e = new RiskEngine({ now: () => 1000 });
    expect(e.evaluate([carNearCenter()]).alerts).toHaveLength(0);
  });

  it('alerts on the second consecutive sighting', () => {
    let now = 1000;
    const e = new RiskEngine({ now: () => now });
    e.evaluate([carNearCenter()]);
    now += 500;
    const { alerts } = e.evaluate([carNearCenter()]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].level).toBe('high');
    expect(alerts[0].escalated).toBe(false);
  });

  it('2-of-3 window: sighting, miss, sighting still alerts', () => {
    const e = new RiskEngine({ now: () => 1000 });
    e.evaluate([carNearCenter()]);
    e.evaluate([]);
    expect(e.evaluate([carNearCenter()]).alerts).toHaveLength(1);
  });

  it('cooldown suppresses a repeat alert for the same class+direction', () => {
    let now = 1000;
    const e = new RiskEngine({ now: () => now });
    e.evaluate([carNearCenter()]);
    e.evaluate([carNearCenter()]); // alert #1
    now += 5_000; // inside 20 s cooldown
    e.evaluate([carNearCenter()]);
    expect(e.evaluate([carNearCenter()]).alerts).toHaveLength(0);
  });

  it('closer proximity breaks the cooldown', () => {
    let now = 1000;
    const e = new RiskEngine({ now: () => now });
    e.evaluate([carMediumCenter()]);
    e.evaluate([carMediumCenter()]); // high alert at medium proximity
    now += 5_000; // inside the 20 s cooldown…
    const { alerts } = e.evaluate([carNearCenter()]); // …but now NEAR — breaks through
    expect(alerts).toHaveLength(1);
    // And once alerted at near, the same near sighting is suppressed again.
    expect(e.evaluate([carNearCenter()]).alerts).toHaveLength(0);
  });

  it('low-level candidates never alert even when persistent', () => {
    const e = new RiskEngine({ now: () => 1000 });
    e.evaluate([chairNear()]);
    e.evaluate([chairNear()]);
    expect(e.evaluate([chairNear()]).alerts).toHaveLength(0);
  });

  it('third unacknowledged high alert within 5 minutes escalates', () => {
    let now = 0;
    const e = new RiskEngine({ now: () => now });
    const fireHigh = () => [
      ...e.evaluate([carNearCenter()]).alerts,
      ...e.evaluate([carNearCenter()]).alerts,
    ];
    expect(fireHigh()[0].escalated).toBe(false); // t=0
    now = 30_000; // past cooldown
    expect(fireHigh()[0].escalated).toBe(false);
    now = 60_000;
    expect(fireHigh()[0].escalated).toBe(true);
  });

  it('acknowledge() clears the escalation window', () => {
    let now = 0;
    const e = new RiskEngine({ now: () => now });
    const fireHigh = () => [
      ...e.evaluate([carNearCenter()]).alerts,
      ...e.evaluate([carNearCenter()]).alerts,
    ];
    fireHigh();
    now = 30_000;
    fireHigh();
    e.acknowledge();
    now = 60_000;
    expect(fireHigh()[0].escalated).toBe(false);
  });

  it('different directions are independent alert keys', () => {
    const e = new RiskEngine({ now: () => 1000 });
    const carLeft = det('car', 0.9, 0.0, 0.3, 0.5, 0.5); // cx .25 → left, near
    e.evaluate([carLeft]);
    expect(e.evaluate([carNearCenter()]).alerts).toHaveLength(0); // center seen once
    expect(e.evaluate([carLeft]).alerts).toHaveLength(1); // left seen twice
  });
});
