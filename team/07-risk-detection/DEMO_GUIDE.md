# 07 — Demo Guide: Risk Detection

## Live demo (45 seconds)

1. Use the gallery sample with a vehicle close to the camera
   (`assets/samples/street-bus.jpg`): run detection and let the hazard
   announcement interrupt/speak with priority wording.
2. Open the Alerts screen (`src/app/alerts.tsx`) and show the recorded
   alert plus the blind-spots (NOT_DETECTABLE) list in the app.

## Expected behavior

- A near, high-category detection produces a spoken warning, not just a
  description line.
- The alert appears in the on-device alert history with its level.
- No distance in metres is ever announced — only near/medium/far.

## Fallback

- If the sample does not cross a threshold on the demo device, open the
  Alerts screen and walk the committee through a previously recorded
  alert, saying clearly it is a stored record.
- Show the NOT_DETECTABLE list either way — it is part of the demo, not
  an admission to hide.

## Before the session

- Produce one real alert on the demo phone beforehand (sample image run)
  so the history is not empty.
- Keep expectations honest: thresholds are per-category (a distant chair
  correctly stays a description, not an alarm).
