# 08 — Expected Questions: Places & GPS

**Q1. Where are saved places stored?**
On the device, through `PlacesStore` over AsyncStorage — max 200.
They are the wearer's private data; guardians can never see them, and
the app's own copy says so.

**Q2. Then what is places sync?**
An opt-in sync with the user's *own* BASERA account (e.g., across their
devices), with typed outcomes (`synced`/`unconfigured`/`signed-out`/
`failed`). Off by default; unrelated to guardian sharing.

**Q3. How does the app turn coordinates into an address?**
Reverse geocoding with a fallback chain: Nominatim (with a declared
User-Agent, ~100 m cache cells, ≥1.1 s request throttle per its usage
policy) → the device geocoder → coordinates-only. Low-accuracy fixes
are labelled approximate.

**Q4. Why can you state metres here but not for camera obstacles?**
Different inputs: GPS coordinates are real measurements, so Haversine
distance between two fixes is a real number. A bounding box in a photo
has no scale reference — there, metres would be fabrication.

**Q5. How do proximity alerts avoid spamming?**
Per-place 30-minute cooldown (`PROXIMITY_COOLDOWN_MS`), only places
with `proximityEnabled`, within the configured radius, sorted by
distance; hits are queued as pending events and announced once.

**Q6. What if location permission is denied?**
`getCurrentFix` returns a typed `permission` error and the UI explains
how to enable it. Features that need a fix degrade honestly; nothing
falls back to a made-up location.

**Q7. What does the My Location card show?**
The fix state from a six-state freshness machine (fresh ≤ 3 min,
stale, etc. — shared logic with the Guardian PWA), the resolved
address, and an OSM tile preview whose marker comes only from a real
fix, with visible OpenStreetMap attribution per their tile policy.

**Q8. Is the user's location history kept?**
For places: only what the user saved. For guardian sharing: the
backend keeps only the *latest* location (section 10). There is no
secret track log in the app.

**Q9. Arabic place-name search — how does matching work?**
`placesText.ts` normalizes names (diacritics/letter variants) before
matching, so a spoken or typed query finds the saved place despite
Arabic spelling variation.

**Q10. Battery impact of GPS here?**
Places features use one-shot fixes on demand, not continuous tracking.
Continuous collection exists only inside the opt-in guardian sharing
flow (section 10) with its own battery disclosure.

**Q11. Why Nominatim and not Google Maps?**
Free, no API key, and its usage policy is satisfiable with caching and
throttling — appropriate for a graduation project. The geocoder sits
behind `geocode.ts`, so the provider is replaceable.

**Q12. What happens offline?**
Saved places, descriptions, and distance statements between stored
coordinates work offline. Address resolution needs network for
Nominatim and otherwise falls back to the device geocoder or
coordinates.
