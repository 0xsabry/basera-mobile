/**
 * Startup latency warm-ups. Neither warm-up produces speech, UI, or
 * any user-visible effect: one enumerates the device TTS voices so
 * the first narration does not pay that cost, the other loads the
 * YOLO interpreter so the first detection does not pay it. (The
 * no-entry-speech guard stays intact: nothing here speaks.)
 */
import { speechService } from './SpeechService';
import { prewarmYoloModel } from './ObjectDetector';

export function startLatencyWarmUps(): void {
  speechService.warmUp();
  prewarmYoloModel();
}
