# 05 — Source Map: OCR

## Engines and routing

| Path | Key exports | Role |
|---|---|---|
| `src/ai/TextRecognizer.ts` | `TextRecognizer` (interface), `MlKitTextRecognizer`, `RoutingTextRecognizer`, `OcrUnavailableError`, `detectTextLanguage()` | One contract, two engines, language-aware routing with cross-fallback |
| `src/ai/ArabicOcrEngine.ts` | `ArabicOcrEngine`, `DET_CANVAS = 960`, `REC_H = 48`, `REC_W = 640`, `REC_CLASSES = 163`, `detFit()`, `extractTextBoxes()`, `ctcGreedyDecode()` | The PP-OCRv3 Arabic pipeline |
| `src/ai/arabicDict.ts` | `ARABIC_OCR_CHARS` (161 entries) | PaddleOCR's official Arabic CTC dictionary, verbatim: class 0 = blank, 1..161 = characters, 162 = space |
| `src/ai/normalizeImage.ts` | `normalizeImage()` | Shared input normalization (the Arabic engine has none of its own, so the router normalizes once for both) |

## Model assets

| Path | Facts |
|---|---|
| `assets/models/ppocr_det.tflite` | Text detection model, 2,408,968 bytes, SHA-256 begins `04e8e0b6…` |
| `assets/models/ppocr_arabic_rec.tflite` | Arabic recognition model, 8,960,168 bytes, SHA-256 begins `1fc31af5…` |
| ML Kit | On-device Google ML Kit text recognition — no bundled model file in the repo (provided by the ML Kit library / Play services) |

## Flow

1. `src/app/read.tsx` gets a `CapturedImage` from the chosen `ImageSource`.
2. `RoutingTextRecognizer.recognize()` normalizes the image once.
3. Preferred engine first (Arabic UI → PP-OCR; English UI → ML Kit); on an
   empty/failed result, the other engine is tried (cross-fallback).
4. Arabic path: det model finds text boxes (`extractTextBoxes`), each line
   is resized to 48×640, the rec model outputs per-timestep class scores,
   `ctcGreedyDecode()` collapses them to a string.
5. The result (`OcrResult` in `src/ai/types.ts`) is spoken verbatim — OCR
   text is never rewritten by narration rules.

## Tests

| Path | Covers |
|---|---|
| `src/ai/__tests__/arabicOcr.test.ts` | CTC decoding, box extraction, dictionary layout |
| `src/ai/__tests__/normalizeImage.test.ts` | Shared normalization |
| Sample inputs | `assets/samples/text-arabic.png`, `assets/samples/text-english.png` |
