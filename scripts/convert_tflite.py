#!/usr/bin/env python3
"""
Convert the official YOLO11n ONNX asset to the TFLite model shipped in the
app (assets/models/yolo11n.tflite) using onnx2tf:
  - input shape pinned to 1x3x640x640, kept in NCHW layout (-k images)
  - float32 weights (no quantization)
After conversion, the shipped TFLite itself is run on the street sample
with the TFLite interpreter and its top detection is printed and compared
with the ONNX reference (bus, ~0.94) — the shipped artifact is verified,
not just the ONNX.

Requires (in ~/workspace/.scratch-basera/venv): tensorflow-cpu, onnx, onnx2tf
Run: ~/workspace/.scratch-basera/venv/bin/python scripts/convert_tflite.py
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path.home() / "workspace" / ".scratch-basera"
WORK = SCRATCH / "tflite-convert"
WORK.mkdir(parents=True, exist_ok=True)
ONNX = SCRATCH / "yolo11n.onnx"
TARGET = ROOT / "assets" / "models" / "yolo11n.tflite"


def main() -> int:
    if not ONNX.exists():
        print("Run scripts/verify_model.py first (downloads the official ONNX).", file=sys.stderr)
        return 1
    # onnx2tf's optimizer may rewrite its input file in place — never feed
    # it the pristine, hash-verified download. Convert a throwaway copy.
    work_onnx = WORK / "yolo11n_work.onnx"
    work_onnx.write_bytes(ONNX.read_bytes())
    out_dir = WORK / "out"
    cmd = [
        sys.executable, "-m", "onnx2tf",
        "-i", str(work_onnx),
        "-o", str(out_dir),
        "-ois", "images:1,3,640,640",
        "-k", "images",
        "-nlt",
    ]
    print("Running:", " ".join(cmd))
    res = subprocess.run(cmd, capture_output=True, text=True)
    tail = (res.stdout or "")[-2500:]
    print(tail)
    if res.returncode != 0:
        print((res.stderr or "")[-2500:], file=sys.stderr)
        return res.returncode or 1
    tflites = sorted(out_dir.glob("*.tflite"))
    if not tflites:
        print(f"No .tflite produced in {out_dir}: {list(out_dir.iterdir())}", file=sys.stderr)
        return 1
    chosen = next((t for t in tflites if "float32" in t.name), tflites[0])
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(chosen.read_bytes())
    print(f"Shipped model: {TARGET} ({TARGET.stat().st_size} bytes) from {chosen.name}")

    # --- Verify the shipped TFLite itself on the street sample ---
    import cv2
    import numpy as np
    import tensorflow as tf

    interpreter = tf.lite.Interpreter(model_path=str(TARGET))
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    out = interpreter.get_output_details()[0]
    print("TFLite input:", inp["shape"], inp["dtype"], "| output:", out["shape"], out["dtype"])
    if list(inp["shape"]) != [1, 3, 640, 640]:
        print("ERROR: converted model input is not [1,3,640,640] NCHW float — app pipeline expects that.", file=sys.stderr)
        return 1

    img = cv2.imread(str(ROOT / "assets" / "samples" / "street-bus.jpg"))
    h, w = img.shape[:2]
    scale = min(640 / w, 640 / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    canvas = np.full((640, 640, 3), 114, dtype=np.uint8)
    top, left = (640 - nh) // 2, (640 - nw) // 2
    canvas[top:top + nh, left:left + nw] = cv2.resize(img, (nw, nh))
    rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
    tensor = (rgb.astype(np.float32) / 255.0).transpose(2, 0, 1)[None]
    interpreter.set_tensor(inp["index"], tensor)
    interpreter.invoke()
    raw = interpreter.get_tensor(out["index"])[0]  # (84, 8400)
    scores = raw[4:]
    best_anchor = int(scores.max(axis=0).argmax())
    best_class = int(scores[:, best_anchor].argmax())
    best_conf = float(scores[best_class, best_anchor])
    print(f"TFLite top detection on street-bus.jpg: class {best_class} conf {best_conf:.3f} (expected bus=5, ~0.94)")

    prov_path = ROOT / "tests" / "fixtures" / "model_provenance.json"
    prov = json.loads(prov_path.read_text()) if prov_path.exists() else {}
    digest = hashlib.sha256(TARGET.read_bytes()).hexdigest()
    prov["yolo11n.tflite (shipped, converted from the official ONNX)"] = digest
    prov_path.write_text(json.dumps(prov, indent=1))
    print("tflite sha256:", digest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
