# 05 — OCR

**Duration: 2 minutes**

## Scope

- Two recognition engines behind one interface:
  - Arabic: an on-device PP-OCRv3 pipeline (detection model + Arabic
    recognition model, both TFLite).
  - Latin/English: ML Kit text recognition on-device.
- Routing: the app language picks the first engine; the other engine is the
  fallback. One shared image normalization for both.
- The pipeline: image → text-box detection → line recognition → CTC decode →
  spoken text.
- Known limits, stated honestly: dotted-letter confusion in Arabic,
  handwriting and decorative fonts are weak.

## Out of scope

Object detection (04) and speech output details (06) — this section ends at
recognized text; the read screen speaks it via the voice system.

## Shared documentation

- [Models](../../docs/MODELS.md)
- [Architecture](../../docs/ARCHITECTURE.md)

## Files in this folder

`SOURCE_MAP.md`, `CODE_WALKTHROUGH.md`, `PRESENTATION.md`, `DEMO_GUIDE.md`,
`EXPECTED_QUESTIONS.md`.
