# 04 — Expected Questions: YOLO & TFLite

**Q1. Why YOLO11n and not a bigger YOLO or a cloud API?**
The nano model is ~10 MB and runs in real time on a mid-range phone with
no network. A cloud API would add latency, cost, and a privacy problem
(photos leaving the device). Bigger variants buy accuracy we cannot
afford in size and battery on the target devices.

**Q2. What does the model output before your code touches it?**
8400 candidate boxes, each with box coordinates and scores for 80 COCO
classes. Raw output is not user-presentable — hence post-processing.

**Q3. Explain the letterbox step.**
The model needs 640×640. We scale the image by one factor and pad the
remainder instead of stretching, so object proportions survive and box
coordinates map back to the original image exactly via `computeLetterbox()`.

**Q4. Why confidence 0.35 and IoU 0.45?**
0.35 keeps recall for safety-relevant objects while cutting noise; the
risk layer applies its own per-category thresholds on top (section 07).
IoU 0.45 is the standard NMS setting that merges duplicate boxes of one
object without merging two close objects.

**Q5. How do you avoid announcing the same object three times?**
NMS: after sorting by confidence, boxes overlapping a kept box by more
than the IoU threshold are suppressed. The narration layer also dedupes
by label/position.

**Q6. What is TFLite and why not ONNX or PyTorch Mobile?**
TensorFlow Lite is the deployment runtime the model was exported to,
with a mature React Native binding (`react-native-fast-tflite`). The
detector sits behind the `ObjectDetector` interface, so the runtime is
replaceable without touching consumers.

**Q7. How is the model loaded, and what if it fails?**
A module-scope shared promise loads the interpreter once; a failure
clears the promise so the next attempt retries. Failure surfaces as
`DetectorUnavailableError` and the UI says detection is unavailable —
the app never fabricates detections.

**Q8. Why prewarm the model at startup?**
Interpreter creation is the slowest step. Loading it in the background
at app start (no UI, no sound) means the user's first detection does not
pay that cost — measured as the fix for the "first detection takes
seconds" complaint.

**Q9. How did you test a neural network's pipeline in unit tests?**
Deterministic parts are tested directly: letterbox math, decoding, NMS,
thresholds. `tests/fixtures/bus_raw_output.bin` is a real recorded model
output, so `yolo.test.ts` decodes genuine tensors, not synthetic ones.

**Q10. What are the model's limits?**
COCO classes only: it cannot see stairs, holes, fire, glass, or weapons —
the app lists these in `NOT_DETECTABLE` (section 07) instead of implying
coverage. Small/far objects and odd lighting reduce recall, and box size
is not a distance measurement.

**Q11. What license is the model under, and does it matter?**
YOLO11n is AGPL-3.0; that is recorded with the model facts in
`docs/MODELS.md`. For a graduation project it is acceptable and declared;
a commercial release would need a licensing decision.

**Q12. Could you swap in a better model later?**
Yes — replace the `.tflite` asset and the post-processing constants if
the output shape changes; the `ObjectDetector` interface and every
consumer stay untouched.
