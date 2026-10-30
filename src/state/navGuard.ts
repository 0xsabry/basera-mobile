/**
 * Double-tap guard for navigation pushes: an accidental rapid second tap
 * on the same action must not stack the same screen twice. Different
 * destinations are never blocked.
 */
import { router, type Href } from 'expo-router';

let lastPath: string | null = null;
let lastAt = 0;
const WINDOW_MS = 700;

export function pushOnce(path: Href, now: number = Date.now()): boolean {
  const key = String(path);
  if (lastPath === key && now - lastAt < WINDOW_MS) return false;
  lastPath = key;
  lastAt = now;
  router.push(path);
  return true;
}

/** Test seam. */
export function resetNavGuardForTests(): void {
  lastPath = null;
  lastAt = 0;
}
