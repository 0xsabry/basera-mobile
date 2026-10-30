/**
 * Background location task HANDLER — pure orchestration with injected
 * dependencies (unit-tested with fakes). The TaskManager registration
 * in backgroundTask.ts wires the real dependencies.
 *
 * Per delivered batch:
 * 1. Try to upload via the guardian service when it is configured and
 *    signed in; on success record the confirmed-upload timestamp.
 * 2. ANY failure (unconfigured / signed out / offline / server error)
 *    → append the points to the offline queue for the foreground flush.
 *    Points are never silently dropped and success is never faked.
 * 3. Run the headless-safe proximity check on the newest fix: matches
 *    are RECORDED as pending events (surfaced next launch). No speech
 *    is attempted headless — TTS is not guaranteed in this context.
 */
import type { LocationPointInput } from './GuardianService';

export interface BackgroundBatchDeps {
  /** True when uploads can even be attempted (configured + signed in). */
  uploadsAvailable: () => Promise<boolean>;
  upload: (points: LocationPointInput[]) => Promise<void>;
  enqueueOffline: (points: LocationPointInput[]) => Promise<void>;
  recordUploadSuccess: (at: number) => Promise<void>;
  /** Optional proximity hook (records pending events only). */
  proximity?: (newest: LocationPointInput) => Promise<void>;
  now?: () => number;
}

export interface BackgroundBatchResult {
  received: number;
  uploaded: number;
  queued: number;
}

export async function handleLocationBatch(
  locations: LocationPointInput[],
  deps: BackgroundBatchDeps,
): Promise<BackgroundBatchResult> {
  if (locations.length === 0) return { received: 0, uploaded: 0, queued: 0 };
  let uploaded = 0;
  let queued = 0;
  try {
    if (await deps.uploadsAvailable()) {
      await deps.upload(locations);
      uploaded = locations.length;
      await deps.recordUploadSuccess(deps.now ? deps.now() : Date.now());
    } else {
      await deps.enqueueOffline(locations);
      queued = locations.length;
    }
  } catch {
    // Upload attempt failed → queue instead of dropping.
    try {
      await deps.enqueueOffline(locations);
      queued = locations.length;
    } catch {
      /* storage failure: nothing more can be done headless */
    }
  }
  if (deps.proximity) {
    try {
      await deps.proximity(locations[locations.length - 1]);
    } catch {
      /* proximity is best-effort in the background */
    }
  }
  return { received: locations.length, uploaded, queued };
}
