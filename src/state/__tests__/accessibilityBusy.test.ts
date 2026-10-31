/**
 * accessibilityBusy registry: existing semantics intact + the new
 * subscribeAccessibilityBusy idle-listener mechanism (Bug 2).
 */
import {
  accessibilityBusySources,
  isAccessibilityBusy,
  resetAccessibilityBusy,
  setAccessibilityBusy,
  subscribeAccessibilityBusy,
} from '../accessibilityBusy';

beforeEach(() => {
  resetAccessibilityBusy();
});

afterEach(() => {
  resetAccessibilityBusy();
});

describe('existing busy semantics', () => {
  it('tracks counts per source', () => {
    expect(isAccessibilityBusy()).toBe(false);
    setAccessibilityBusy('speech', true);
    setAccessibilityBusy('speech', true);
    setAccessibilityBusy('processing', true);
    expect(isAccessibilityBusy()).toBe(true);
    expect(accessibilityBusySources()).toEqual(expect.arrayContaining(['speech', 'processing']));
    setAccessibilityBusy('speech', false);
    expect(isAccessibilityBusy()).toBe(true); // speech count still 1
    setAccessibilityBusy('speech', false);
    setAccessibilityBusy('processing', false);
    expect(isAccessibilityBusy()).toBe(false);
    expect(accessibilityBusySources()).toEqual([]);
  });

  it('never goes negative', () => {
    setAccessibilityBusy('hazard', false);
    expect(isAccessibilityBusy()).toBe(false);
  });
});

describe('subscribeAccessibilityBusy', () => {
  it('fires when the aggregate busy state flips, in both directions', () => {
    const listener = jest.fn();
    const unsub = subscribeAccessibilityBusy(listener);
    setAccessibilityBusy('speech', true);
    expect(listener).toHaveBeenCalledTimes(1);
    setAccessibilityBusy('speech', false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('does not fire when the aggregate state does not change', () => {
    const listener = jest.fn();
    subscribeAccessibilityBusy(listener);
    setAccessibilityBusy('speech', true);
    setAccessibilityBusy('processing', true); // still busy overall
    expect(listener).toHaveBeenCalledTimes(1);
    setAccessibilityBusy('speech', false); // processing still busy
    expect(listener).toHaveBeenCalledTimes(1);
    setAccessibilityBusy('processing', false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops notifications', () => {
    const listener = jest.fn();
    const unsub = subscribeAccessibilityBusy(listener);
    unsub();
    setAccessibilityBusy('speech', true);
    setAccessibilityBusy('speech', false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('reset while busy notifies listeners (busy cleared)', () => {
    const listener = jest.fn();
    subscribeAccessibilityBusy(listener);
    setAccessibilityBusy('recognition', true);
    expect(listener).toHaveBeenCalledTimes(1);
    resetAccessibilityBusy();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(isAccessibilityBusy()).toBe(false);
  });
});
