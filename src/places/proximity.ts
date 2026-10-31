/**
 * Proximity — public surface of the proximity checker + storage.
 *
 * The pure checker and the pending-event storage live in
 * proximityCore.ts (headless-safe, shared with the background task,
 * which records an event when the wearer comes within radius of a
 * saved place). Recorded events are surfaced as TEXT in Places.
 *
 * The former foreground speech announcer (announceNearbyPlaces) was
 * REMOVED by owner order 2026-11-01: it fired on Home/Places focus, so
 * the app spoke on its own whenever the wearer opened it near a saved
 * place. Entry and tab switches are silent now — speech answers user
 * actions only (the voice assistant still answers a spoken "what is
 * near me" command, which is a direct user request).
 */
export {
  PROXIMITY_COOLDOWN_MS,
  checkProximity,
  drainPendingProximityEvents,
  recordPendingProximityEvent,
  type PendingProximityEvent,
  type ProximityHit,
} from './proximityCore';
