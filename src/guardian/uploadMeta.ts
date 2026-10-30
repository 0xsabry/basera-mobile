/**
 * Last-successful-upload bookkeeping. The Family screen's "last update"
 * timestamp comes from here — it is written ONLY after an upload call
 * actually succeeds, never optimistically.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LAST_UPLOAD_AT_KEY = 'basera.guardian.lastUploadAt.v1';

export async function recordSuccessfulUpload(at: number = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_UPLOAD_AT_KEY, String(at));
  } catch {
    /* bookkeeping only */
  }
}

export async function getLastSuccessfulUploadAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_UPLOAD_AT_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
