# 04 — Demo Guide: YOLO & TFLite

## Live demo (60–90 seconds)

1. Airplane mode ON (prove it is on-device).
2. Smart Assistant → detect → gallery source → `assets/samples/street-bus.jpg`
   content (the bundled sample images exist for exactly this).
3. Let it speak: expect the bus and nearby objects named with positions.
4. Repeat with `assets/samples/people.jpg` for person detections.

## Expected behavior

- First detection after app start is faster than it used to be because the
  model was prewarmed at startup (`prewarmYoloModel()`).
- Each object is announced once (NMS working), with a position word
  (left / center / right) — positions come from section 06's narration on
  top of these detections.

## Fallback

- If detection errors on the demo device, the app says detection is
  unavailable (typed error) — use that honestly: show the error message,
  then open the same image's stored result in History.
- Never describe a detection the app did not just produce.

## Before the session

- Run one detection on the actual demo phone the night before (model load
  is device-dependent) and keep that result in History as the fallback.
