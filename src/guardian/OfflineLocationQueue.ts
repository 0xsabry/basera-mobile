/**
 * Offline queue for background location points. When the background
 * task cannot upload (service unconfigured, signed out, or offline),
 * points land here (AsyncStorage) and the foreground sharing service
 * flushes them on next launch/foreground. Cap ~500, FIFO — the oldest
 * points drop first (24 h server retention makes stale points moot).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationPointInput } from './GuardianService';

export const OFFLINE_QUEUE_KEY = 'basera.guardian.offlineQueue.v1';
export const OFFLINE_QUEUE_CAP = 500;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const defaultStorage: KeyValueStorage = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
};

export class OfflineLocationQueue {
  constructor(
    private readonly storage: KeyValueStorage = defaultStorage,
    private readonly cap: number = OFFLINE_QUEUE_CAP,
  ) {}

  async list(): Promise<LocationPointInput[]> {
    try {
      const raw = await this.storage.getItem(OFFLINE_QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as LocationPointInput[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async count(): Promise<number> {
    return (await this.list()).length;
  }

  async enqueue(points: LocationPointInput[]): Promise<void> {
    if (points.length === 0) return;
    const next = [...(await this.list()), ...points].slice(-this.cap);
    await this.storage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
  }

  /** Remove and return up to `max` oldest points (FIFO). */
  async drain(max = this.cap): Promise<LocationPointInput[]> {
    const all = await this.list();
    const out = all.slice(0, max);
    const rest = all.slice(out.length);
    await this.storage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(rest));
    return out;
  }

  async clear(): Promise<void> {
    await this.storage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([]));
  }
}

export const offlineLocationQueue = new OfflineLocationQueue();
