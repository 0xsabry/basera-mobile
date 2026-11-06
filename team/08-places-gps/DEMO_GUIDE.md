# 08 — Demo Guide: Places & GPS

## Live demo (45–60 seconds)

1. Places screen: show a pre-saved place, use "Listen" to hear its spoken
   description and distance statement.
2. My Location card (Family tab): show the current fix, the resolved
   address, and the freshness label; point at the map preview attribution.
3. If indoors GPS is weak, the card honestly shows stale/unavailable —
   use that as the honesty talking point rather than fighting it.

## Expected behavior

- Distance to a saved place is stated in metres (real GPS math).
- A place added from the current fix appears in the list immediately and
  survives an app restart (device storage).

## Fallback

- No GPS fix in the hall: demonstrate with the saved-places list and the
  spoken description (works fully offline), and explain the fix states
  from `currentFix.ts` (`permission` / `unavailable`).
- Proximity alerts need movement; do not fake a hit — describe the
  cooldown rule from the code instead.

## Before the session

- Save 2–3 real places on the demo phone (e.g., the university) in
  advance.
- Enable device location and grant the app permission beforehand.
