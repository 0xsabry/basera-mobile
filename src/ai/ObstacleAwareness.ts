/**
 * Obstacle awareness — derived ONLY from 2D detections.
 *
 * IMPORTANT (honesty contract):
 * Detecting an object in an image is NOT the same as measuring its distance.
 * A bounding box tells us *what* and roughly *where in the frame* something is,
 * and how large it appears. Apparent size correlates loosely with distance for
 * a known object type, but it is NOT a measurement: a small nearby object and
 * a large far object can produce identical boxes.
 *
 * Therefore this module only produces a heuristic proximity *category*
 * (near / medium / far) based on the box's relative area, and a relative
 * horizontal position (left / center / right). It NEVER outputs meters.
 * Real distance requires a depth source (stereo, ToF, LiDAR, structured
 * light) which the future smart glasses may provide; until then, the UI must
 * present these labels as rough guidance, not measurements.
 */
import type { Detection } from './types';

export type HorizontalPosition = 'left' | 'center' | 'right';
export type ProximityCategory = 'near' | 'medium' | 'far';

export interface ObstacleInfo {
  detection: Detection;
  position: HorizontalPosition;
  proximity: ProximityCategory;
  /** Box area as a fraction of the whole frame (0..1). */
  relativeArea: number;
}

export function horizontalPosition(d: Detection): HorizontalPosition {
  const cx = d.box.x + d.box.width / 2;
  if (cx < 0.38) return 'left';
  if (cx > 0.62) return 'right';
  return 'center';
}

/**
 * Heuristic only — see module docstring. Thresholds on relative frame area:
 * a person filling >18% of the frame is *probably* close; <3% probably far.
 */
export function proximityCategory(d: Detection): ProximityCategory {
  const area = d.box.width * d.box.height;
  if (area >= 0.18) return 'near';
  if (area >= 0.04) return 'medium';
  return 'far';
}

export function analyzeObstacles(detections: Detection[]): ObstacleInfo[] {
  return detections
    .map((detection) => ({
      detection,
      position: horizontalPosition(detection),
      proximity: proximityCategory(detection),
      relativeArea: detection.box.width * detection.box.height,
    }))
    // Most prominent (largest apparent size) first — likely most relevant.
    .sort((a, b) => b.relativeArea - a.relativeArea);
}

/** Classes that matter most for safe navigation; used for ordering. */
export const PRIORITY_CLASSES = new Set([
  'person', 'car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train',
  'chair', 'couch', 'dining table', 'bed', 'door',
]);
