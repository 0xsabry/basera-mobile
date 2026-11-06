# 08 — Source Map: Places & GPS

## Saved places

| Path | Key exports | Role |
|---|---|---|
| `src/places/PlacesStore.ts` | `PlacesStore`, `placesStore`, `Place`, `PlaceCategory`, `PLACE_CATEGORIES`, `MAX_PLACES = 200`, `PlacesStorage` | CRUD over device storage (AsyncStorage-backed); the single source for places |
| `src/places/PlacesAssistant.ts` | `PlacesAssistant`, `describePlace()`, `categoryLabel()` | Spoken descriptions and answers about saved places |
| `src/places/placesText.ts` | `normalizePlaceName()`, `placeNameMatches()`, `haversineMeters()`, `distanceStatement()` | Name matching (Arabic-friendly normalization) and GPS-true distance statements |
| `src/places/placesSync.ts` | `syncPlaces()`, `PlacesSyncOutcome` (`synced`/`unconfigured`/`signed-out`/`failed`) | Opt-in sync with the user's own account; honest outcome reporting |
| `src/app/places.tsx` | Places screen | List, add (from current fix), edit, mark visited, listen |

## GPS and addresses

| Path | Key exports | Role |
|---|---|---|
| `src/places/currentFix.ts` | `getCurrentFix()`, `getFixIfPermitted()`, `GeoFix`, `FixError` (`permission`/`unavailable`) | One-shot position with typed failures — never a fake fix |
| `src/places/geocode.ts` | `formatAddress()`, `formatDeviceAddress()`, `ResolvedAddress`, `GeocodeSource` (`nominatim`/`device`/`none`) | Reverse geocoding: Nominatim first (User-Agent `BASERA/1.1 (me.auramarketing.basera)`, ~100 m cache cell, ≥1.1 s throttle), then the device geocoder, then coordinates-only honesty; "approximate" is stated when accuracy > 100 m |
| `src/components/MyLocationCard.tsx` | My Location card | Shows fix state, address, and freshness |
| `src/guardian/locationStatus.ts` | Location freshness state machine | fresh (≤3 min) / stale and related states, shared by app and PWA logic |
| `src/components/LocationMapPreview.tsx`, `src/guardian/tileMath.ts` | OSM tile preview | Viewport-only tiles, real marker only from a real fix, visible © OpenStreetMap attribution |

## Proximity

| Path | Key exports | Role |
|---|---|---|
| `src/places/proximityCore.ts` | `checkProximity()`, `PROXIMITY_COOLDOWN_MS = 30 min`, `recordPendingProximityEvent()`, `drainPendingProximityEvents()` | Pure proximity decision + a pending-event queue for announcements |
| `src/places/proximity.ts` | Runtime wiring | Connects fixes, the store, and speech |

## Permissions

Foreground location is requested in context (`getCurrentFix(true)`);
`getFixIfPermitted()` never prompts — used where a silent check is the
honest behavior. Background location belongs to Guardian sharing (10).

## Tests

`src/places/__tests__/places.test.ts`, `geocode.test.ts`,
`src/guardian/__tests__/locationStatus.test.ts`, `tileMath.test.ts`.
