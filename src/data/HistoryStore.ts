/**
 * On-device history of analyses. Stored ONLY on this device
 * (AsyncStorage index + copied images in the app's document directory).
 * Nothing is uploaded anywhere. Users can delete single items or clear all.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Detection } from '../ai/types';

const STORAGE_KEY = 'basera.history.v1';
export const MAX_HISTORY_ITEMS = 50;

export interface HistoryItem {
  id: string;
  timestamp: number;
  kind: 'detection' | 'ocr';
  imageUri: string;
  sourceKind: string;
  detections?: Detection[];
  description?: string;
  ocrText?: string;
  ocrLanguage?: string;
}

export interface HistoryStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const defaultStorage: HistoryStorage = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
};

export class HistoryStore {
  constructor(private readonly storage: HistoryStorage = defaultStorage) {}

  async list(): Promise<HistoryItem[]> {
    try {
      const raw = await this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as HistoryItem[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async add(item: Omit<HistoryItem, 'id' | 'timestamp'>): Promise<HistoryItem> {
    const full: HistoryItem = {
      ...item,
      id: `h-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      timestamp: Date.now(),
    };
    const items = [full, ...(await this.list())].slice(0, MAX_HISTORY_ITEMS);
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(items));
    return full;
  }

  async remove(id: string): Promise<void> {
    const items = (await this.list()).filter((i) => i.id !== id);
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  async clear(): Promise<void> {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify([]));
  }
}

/** Copies a picked image into app-private storage so history survives. */
export async function persistImageCopy(sourceUri: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require('expo-file-system');
    const dir = `${FileSystem.documentDirectory}basera-history/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
    const ext = sourceUri.split('.').pop()?.split('?')[0] ?? 'jpg';
    const dest = `${dir}${Date.now()}.${ext}`;
    await FileSystem.copyAsync({ from: sourceUri, to: dest });
    return dest;
  } catch {
    return sourceUri; // Fall back to the original URI; history still records results.
  }
}

export const historyStore = new HistoryStore();
