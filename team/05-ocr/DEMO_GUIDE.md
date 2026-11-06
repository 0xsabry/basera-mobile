# 05 — Demo Guide: OCR

## Live demo (45–60 seconds)

1. Read screen → gallery source → `assets/samples/text-arabic.png`
   (bundled sample): the Arabic PP-OCR pipeline reads it aloud.
2. Switch to `assets/samples/text-english.png` for the ML Kit path.
3. If a printed page is available, use the phone-camera test source on a
   clear, well-lit printed line — printed text only, not handwriting.

## Expected behavior

- Arabic sample is routed to PP-OCR first (Arabic UI) and spoken verbatim.
- English sample routes to ML Kit first.
- Processing is on-device; airplane mode is fine.

## Fallback

- Bad lighting/angle on a live page: retry once with the page flat and
  closer; if it still fails, fall back to the bundled samples and say why
  (lighting is the honest, common cause).
- If Arabic output confuses a dotted letter live, do not hide it — it is a
  documented limitation; show the sample image result instead.

## Before the session

- Pre-run both bundled samples on the demo phone and confirm speech output.
- Print one clean Arabic page (large font) as the controlled live input.
