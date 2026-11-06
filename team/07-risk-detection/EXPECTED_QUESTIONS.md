# 07 — Expected Questions: Risk Detection

**Q1. Why rules on top of the model instead of training a risk model?**
Data and time: a student team cannot collect a trustworthy hazard
dataset. Rules over a proven detector are transparent, testable, and
explainable to this committee line by line — every threshold is a
number in `HAZARD_RULES` we can defend.

**Q2. How is risk level computed?**
`baseRisk()` combines category, proximity category, and direction.
A near vehicle outranks a far chair. The mapping is deterministic and
unit-tested in `riskEngine.test.ts`.

**Q3. Is the proximity a real distance?**
No, and we never present it as one. It is a category inferred from the
bounding box's relative size. A single RGB camera without depth cannot
measure metres honestly.

**Q4. Why is the sharp-object threshold higher (0.55)?**
False-positive budget. Kitchens legitimately contain knives and
scissors in most frames; alerting on all of them trains the user to
ignore alerts. Vehicles get the lowest threshold (0.35) because missing
one is the costliest error.

**Q5. What can the system NOT detect?**
Stairs/steps, holes/drop-offs, fire/smoke, glass doors, weapons,
hanging obstacles above the camera, slippery floors — the COCO model
has no such classes. The list ships in the app (`NOT_DETECTABLE`) and
is shown to users, not buried in a report.

**Q6. Do guardians get notified of hazards?**
Not in production. The notifier seam (`HazardNotifier`) exists and the
shipped implementation returns `unavailable` because there is no
backend hazard table. Claiming otherwise would be false; the manual
SOS (section 10) is the shipped guardian alert path.

**Q7. How do alerts behave while the app is speaking a description?**
They interrupt: `HazardService` speaks alerts with priority over
ongoing narration, and the speech layer's interruption semantics are
preserved by the latency work (section 06).

**Q8. Where are alerts stored?**
On-device in `AlertHistoryStore`, listed in the Alerts screen. They
are the wearer's own record; nothing about camera hazards leaves the
phone in the current version.

**Q9. What about a person walking toward the user?**
`person` is its own category (threshold 0.40); proximity escalation
raises the level as the box grows. There is no tracking/identity — the
system does not recognize who the person is.

**Q10. How did you test the risk layer?**
Pure-function tests over synthetic detections for every category,
threshold boundary, and scoring combination, plus service tests for
the alert flow and notifier outcomes.

**Q11. Could thresholds be tuned per user?**
The constants are centralized in `HAZARD_RULES`, so tuning is a
one-file change; per-user tuning is future work, not a hidden setting.

**Q12. Is a "high" alert a guarantee of danger?**
No. It is a heuristic warning from a 2D detection. The app is an aid,
not a replacement for a cane, a guide, or attention — and its copy
says so.
