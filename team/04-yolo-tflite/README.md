# 04 — YOLO & TFLite

**Duration: 3 minutes**

## Scope

- The object-detection model: YOLO11n (nano) exported to TFLite, bundled in
  the app, running fully on-device.
- The inference pipeline: image normalization → letterbox → tensor → TFLite
  interpreter → YOLO output decoding (confidence filter + NMS) → typed
  `Detection[]`.
- Model file facts: size, hash, license, 80 COCO classes.
- Device integration: lazy shared model loading, startup prewarm, failure
  behavior (`DetectorUnavailableError`).

## Out of scope

What the app *says* about detections (narration is section 06) and the risk
rules on top of them (section 07). This section ends at a list of detections.

## Shared documentation

- [Models](../../docs/MODELS.md)
- [Architecture](../../docs/ARCHITECTURE.md)

## Files in this folder

`SOURCE_MAP.md`, `CODE_WALKTHROUGH.md`, `PRESENTATION.md`, `DEMO_GUIDE.md`,
`EXPECTED_QUESTIONS.md`.
