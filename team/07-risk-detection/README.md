# 07 — Risk Detection

**Duration: 2 minutes**

## Scope

- From detections to warnings: a transparent rule engine
  (`RiskEngine`) classifies detections into hazard categories with
  per-category confidence thresholds, and scores risk from category +
  proximity + direction.
- Alert behavior: `HazardService` speaks high-priority alerts immediately
  (interrupting other speech) and records them in the on-device alert
  history (`alerts` screen).
- The honesty boundary, in code: a `NOT_DETECTABLE` list (stairs, holes,
  fire, glass, weapons, hanging obstacles, slippery floors) is displayed
  in-app, and proximity is a *category* (near/medium/far from bounding-box
  size) — never a distance in metres.
- Guardian notification of hazards: the notifier seam exists, but there is
  no production hazard-alert table — the shipped notifier honestly returns
  `unavailable`. Only the manual SOS (section 10) reaches the backend.

## Out of scope

The detector itself (04) and general narration (06). This section starts
where a `Detection[]` already exists.

## Shared documentation

- [Feature status](../../docs/FEATURE_STATUS.md)
- [Models](../../docs/MODELS.md)

## Files in this folder

`SOURCE_MAP.md`, `CODE_WALKTHROUGH.md`, `PRESENTATION.md`, `DEMO_GUIDE.md`,
`EXPECTED_QUESTIONS.md`.
