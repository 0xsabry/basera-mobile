import {
  hapticAlertHigh,
  hapticAlertMedium,
  hapticConfirm,
  isHapticsEnabled,
  setHapticsEnabled,
  setVibrateImplForTests,
} from '../haptics';
import { scaledType, typeScale } from '../../theme/tokens';

describe('haptics gate', () => {
  const calls: (number | number[])[] = [];
  beforeEach(() => {
    calls.length = 0;
    setVibrateImplForTests((p) => {
      calls.push(p);
    });
    setHapticsEnabled(true);
  });
  afterAll(() => setVibrateImplForTests(null));

  it('confirm buzzes once, briefly', () => {
    hapticConfirm();
    expect(calls).toEqual([40]);
  });

  it('medium and high patterns are distinguishable', () => {
    hapticAlertMedium();
    hapticAlertHigh();
    expect(calls[0]).not.toEqual(calls[1]);
    expect((calls[1] as number[]).length).toBeGreaterThan((calls[0] as number[]).length);
  });

  it('disabled gate makes every helper a no-op', () => {
    setHapticsEnabled(false);
    expect(isHapticsEnabled()).toBe(false);
    hapticConfirm();
    hapticAlertMedium();
    hapticAlertHigh();
    expect(calls).toEqual([]);
  });
});

describe('scaledType', () => {
  it('scale 1 returns the base scale', () => {
    expect(scaledType(1)).toEqual(typeScale);
  });
  it('larger scales multiply and round every entry', () => {
    const s = scaledType(1.3);
    expect(s.body).toBe(Math.round(typeScale.body * 1.3));
    expect(s.title).toBe(Math.round(typeScale.title * 1.3));
    expect(s.button).toBeGreaterThan(typeScale.button);
  });
});
