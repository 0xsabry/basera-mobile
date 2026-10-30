#!/usr/bin/env python3
"""
BASERA host-side model verification.

Model: YOLO11n, official ONNX asset published by Ultralytics:
  https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.onnx
  SHA256 634279b40c07c6391472c51ad45b81ebc48706a9a1fe72dd3396322acd0c053b

This script runs that exact model with onnxruntime on the bundled sample
photos and saves:
  - tests/fixtures/bus_raw_output.bin    raw [84,8400] float32 tensor
  - tests/fixtures/bus_reference.json    Python-reference detections
  - tests/fixtures/zidane_reference.json Python-reference detections
  - tests/fixtures/model_provenance.json SHA256 of model artifacts

The jest suite feeds bus_raw_output.bin through the TypeScript decode+NMS
(src/ai/yoloPostprocess.ts) and asserts it reproduces the Python reference.
The shipped on-device model (assets/models/yolo11n.tflite) is converted
from this same official ONNX by scripts/convert_tflite.py.

Run:  ~/workspace/.scratch-basera/venv/bin/python scripts/verify_model.py
"""
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path.home() / "workspace" / ".scratch-basera"
FIXTURES = ROOT / "tests" / "fixtures"
FIXTURES.mkdir(parents=True, exist_ok=True)

ONNX_URL = "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.onnx"
ONNX_SHA256 = "634279b40c07c6391472c51ad45b81ebc48706a9a1fe72dd3396322acd0c053b"
CONF = 0.35
IOU_THR = 0.45


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def letterbox(img: np.ndarray, size: int = 640):
    import cv2

    h, w = img.shape[:2]
    scale = min(size / w, size / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    pad_x, pad_y = (size - nw) / 2, (size - nh) / 2
    resized = cv2.resize(img, (nw, nh))
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    top, left = int(round(pad_y)), int(round(pad_x))
    canvas[top : top + nh, left : left + nw] = resized
    return canvas


def nms_decode(output: np.ndarray, orig_w: int, orig_h: int):
    """Reference decode: output shape (84, 8400). Mirrors src/ai/yoloPostprocess.ts."""
    scale = min(640 / orig_w, 640 / orig_h)
    pad_x = (640 - orig_w * scale) / 2
    pad_y = (640 - orig_h * scale) / 2
    boxes = output[0:4].T
    scores = output[4:].T
    class_ids = scores.argmax(axis=1)
    confs = scores[np.arange(scores.shape[0]), class_ids]
    cands = []
    for i in np.where(confs >= CONF)[0]:
        cx, cy, w, h = boxes[i]
        x1 = max(0.0, (cx - w / 2 - pad_x) / scale / orig_w)
        y1 = max(0.0, (cy - h / 2 - pad_y) / scale / orig_h)
        x2 = min(1.0, (cx + w / 2 - pad_x) / scale / orig_w)
        y2 = min(1.0, (cy + h / 2 - pad_y) / scale / orig_h)
        if x2 <= x1 or y2 <= y1:
            continue
        cands.append({
            "classId": int(class_ids[i]),
            "confidence": float(confs[i]),
            "box": {"x": float(x1), "y": float(y1), "width": float(x2 - x1), "height": float(y2 - y1)},
        })
    cands.sort(key=lambda c: -c["confidence"])

    def iou(a, b):
        ax, ay, aw, ah = a["box"]["x"], a["box"]["y"], a["box"]["width"], a["box"]["height"]
        bx, by, bw, bh = b["box"]["x"], b["box"]["y"], b["box"]["width"], b["box"]["height"]
        x1, y1 = max(ax, bx), max(ay, by)
        x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
        inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
        union = aw * ah + bw * bh - inter
        return 0.0 if union <= 0 else inter / union

    kept = []
    for c in cands:
        if all(not (k["classId"] == c["classId"] and iou(k, c) > IOU_THR) for k in kept):
            kept.append(c)
        if len(kept) >= 30:
            break
    return kept


def main() -> int:
    import cv2
    import onnxruntime as ort

    onnx_path = SCRATCH / "yolo11n.onnx"
    if not onnx_path.exists():
        print(f"Downloading official model: {ONNX_URL}")
        urllib.request.urlretrieve(ONNX_URL, onnx_path)
    digest = sha256(onnx_path)
    print(f"yolo11n.onnx sha256: {digest}")
    if digest != ONNX_SHA256:
        print("ERROR: model hash mismatch — refusing to verify against an unknown file", file=sys.stderr)
        return 1

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name

    for fname, key, dump_raw in [("street-bus.jpg", "bus", True), ("people.jpg", "zidane", False)]:
        img = cv2.imread(str(ROOT / "assets" / "samples" / fname))
        if img is None:
            print(f"ERROR: cannot read {fname}", file=sys.stderr)
            return 1
        orig_h, orig_w = img.shape[:2]
        canvas = letterbox(img)
        rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
        tensor = (rgb.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
        raw = session.run(None, {input_name: tensor})[0][0]  # (84, 8400)
        dets = nms_decode(raw, orig_w, orig_h)
        ref = {"image": fname, "origWidth": orig_w, "origHeight": orig_h,
               "confidenceThreshold": CONF, "detections": dets}
        (FIXTURES / f"{key}_reference.json").write_text(json.dumps(ref, indent=1))
        print(f"{fname}: {len(dets)} detections")
        for d in dets[:10]:
            print(f"   class {d['classId']} conf {d['confidence']:.3f}")
        if dump_raw:
            (FIXTURES / "bus_raw_output.bin").write_bytes(raw.astype(np.float32).tobytes())
            print(f"Raw tensor dumped: {raw.size} floats")

    prov = {"yolo11n.onnx (official Ultralytics asset v8.3.0)": digest}
    tflite = ROOT / "assets" / "models" / "yolo11n.tflite"
    if tflite.exists():
        prov["yolo11n.tflite (shipped, converted from the official ONNX)"] = sha256(tflite)
    (FIXTURES / "model_provenance.json").write_text(json.dumps(prov, indent=1))
    print(json.dumps(prov, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
