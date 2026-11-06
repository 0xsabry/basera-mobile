# 07 — Source Map: Risk Detection

## Rule engine

| Path | Key exports | Role |
|---|---|---|
| `src/hazards/RiskEngine.ts` | `RiskLevel` (`low`/`medium`/`high`), `HazardCategory` (`vehicle`/`person`/`animal`/`sharp`/`static`), `HazardCandidate`, `HazardAlert`, `HAZARD_RULES`, `NOT_DETECTABLE`, `baseRisk()`, `extractCandidates()` | Pure, deterministic rules over detections — no ML beyond the detector |
| `src/ai/ObstacleAwareness.ts` | `horizontalPosition()`, `proximityCategory()` (`near`/`medium`/`far`), `analyzeObstacles()`, `PRIORITY_CLASSES` | Position + heuristic proximity from bounding boxes; the proximity input to risk scoring |

### HAZARD_RULES (exact, from source)

| Category | COCO classes | Confidence threshold |
|---|---|---|
| vehicle | car, bus, truck, motorcycle, bicycle, train | 0.35 |
| person | person | 0.40 |
| animal | dog, cat, horse, sheep, cow, elephant, bear, zebra, giraffe, bird | 0.40 |
| sharp | knife, scissors | 0.55 (higher: kitchens are full of them; false positives destroy trust) |
| static | chair, bench, couch, dining table, potted plant, bed | 0.50 |

## Alert runtime

| Path | Key exports | Role |
|---|---|---|
| `src/hazards/HazardService.ts` | `HazardNotifier`, `supabaseHazardNotifier`, `GuardianNotifyOutcome` (`sent`/`failed`/`unavailable`), `configureHazardRuntime()`, `hazardAlertText()`, `ProcessResult` | Turns candidates into alerts: speaks them (interrupting), stores them, attempts guardian notify through the seam |
| `src/hazards/AlertHistoryStore.ts` | Alert history persistence | On-device record shown in the alerts screen |
| `src/hazards/HazardEventSource.ts` | Event source seam | Where detection results enter the hazard pipeline |
| `src/app/alerts.tsx` | Alerts screen | Lists recorded alerts with the blind-spots disclaimer |

## The not-detectable list (shipped in-app, from `NOT_DETECTABLE`)

Stairs and steps · Holes and drop-offs · Fire and smoke · Glass doors and
walls · Weapons · Hanging obstacles above camera view · Water, ice and
slippery floors.

## Backend status

`supabaseHazardNotifier` returns `unavailable`: there is **no** production
table or function for camera hazard alerts. SOS (section 10) is a separate,
manual flow that does insert into `sos_alerts`.

## Tests

`src/hazards/__tests__/riskEngine.test.ts` (rules, thresholds, scoring),
`src/hazards/__tests__/hazardService.test.ts` (alert flow, notifier
outcomes), `src/ai/__tests__/logic.test.ts` (obstacle analysis).
