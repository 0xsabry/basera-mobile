/**
 * On-device history of hazard alerts + SOS events. Stored ONLY on this
 * device (AsyncStorage). An event is recorded whenever the risk engine
 * fires a medium/high alert and whenever the user triggers SOS —
 * including when guardian notification was impossible, so the record of
 * what happened never depends on the network.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HazardCategory, RiskLevel } from './RiskEngine';

const STORAGE_KEY = 'basera.alertHistory.v1';
export const MAX_ALERT_EVENTS = 100;

export type AlertEventKind = 'hazard' | 'sos';

export interface AlertEvent {
  id: string;
  timestamp: number;
  kind: AlertEventKind;
  /** COCO class for hazards; 'sos' for manual SOS. */
  className: string;
  category: HazardCategory | 'sos';
  level: RiskLevel;
  direction: 'left' | 'center' | 'right' | null;
  proximity: 'near' | 'medium' | 'far' | null;
  acknowledged: boolean;
  /** Guardian notification outcome — recorded honestly, never assumed. */
  guardianNotify: 'not-attempted' | 'sent' | 'failed' | 'unavailable';
  /** Whether sharing was ON when the event was created (location was
   *  attached server-side only in that case). */
  locationShared: boolean;
}

export interface AlertStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const defaultStorage: AlertStorage = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
};

export class AlertHistoryStore {
  constructor(private readonly storage: AlertStorage = defaultStorage) {}

  async list(): Promise<AlertEvent[]> {
    try {
      const raw = await this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as AlertEvent[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async add(event: Omit<AlertEvent, 'id' | 'timestamp'>): Promise<AlertEvent> {
    const full: AlertEvent = {
      ...event,
      id: `a-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      timestamp: Date.now(),
    };
    const items = [full, ...(await this.list())].slice(0, MAX_ALERT_EVENTS);
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(items));
    return full;
  }

  async acknowledge(id: string): Promise<void> {
    const items = await this.list();
    const next = items.map((i) => (i.id === id ? { ...i, acknowledged: true } : i));
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async acknowledgeAll(): Promise<void> {
    const items = await this.list();
    await this.storage.setItem(
      STORAGE_KEY,
      JSON.stringify(items.map((i) => ({ ...i, acknowledged: true }))),
    );
  }

  async remove(id: string): Promise<void> {
    const items = (await this.list()).filter((i) => i.id !== id);
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  async clear(): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify([]));
  }

  async latestUnacknowledgedHigh(): Promise<AlertEvent | null> {
    const items = await this.list();
    return items.find((i) => i.level === 'high' && !i.acknowledged) ?? null;
  }
}

export const alertHistoryStore = new AlertHistoryStore();
