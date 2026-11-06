# 08 — Places & GPS

**Duration: 2 minutes**

## Scope

- Saved places: the user saves locations (home, university, clinic…) with a
  category, up to 200, stored **on the device**.
- GPS: current-fix acquisition with honest permission/unavailable errors,
  reverse geocoding to a spoken address, and a "My Location" card with a
  freshness state machine and a map-tile preview.
- Proximity: when the user approaches a saved place that has proximity
  alerts on, the app announces it — with a 30-minute per-place cooldown.
- Storage truth: places stay on the device unless the user turns on sync
  with their own BASERA account; **guardians can never see saved places**.
  (Guardian *location sharing* is a different, consent-based flow —
  section 10.)

## Out of scope

The Guardian sharing pipeline and its consent model (10); this section is
the wearer's own places and position.

## Shared documentation

- [Guardian setup (location behavior)](../../docs/GUARDIAN_SETUP.md)
- [Feature status](../../docs/FEATURE_STATUS.md)

## Files in this folder

`SOURCE_MAP.md`, `CODE_WALKTHROUGH.md`, `PRESENTATION.md`, `DEMO_GUIDE.md`,
`EXPECTED_QUESTIONS.md`.
