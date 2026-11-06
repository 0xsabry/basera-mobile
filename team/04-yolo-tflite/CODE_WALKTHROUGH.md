# 04 — Code Walkthrough: YOLO & TFLite

## 1. نقطة الدخول — `src/ai/ObjectDetector.ts`

```ts
export class YoloDetector implements ObjectDetector {
  readonly id = 'yolo11n-tflite';

  async detect(image: CapturedImage): Promise<Detection[]> {
    // Normalize FIRST: any picker format/URI (PNG/WebP/HEIC, content://,
    // huge) becomes a local JPEG with the long edge ≤1280, and format
    // failures surface as typed unsupported-format errors.
    const normalized = await normalizeImage(image);

    // Letterbox is computed from the NORMALIZED dimensions — that is
    // the image the model actually sees.
    const letterbox = computeLetterbox(normalized.width, normalized.height);
    // ... resize, build tensor, run interpreter, decode
  }
}
```

النموذج بيتحمل مرة واحدة على مستوى الوحدة (module-scope shared promise)
من دالة `loadSharedModel()`، ولو التحميل فشل الوعد بيتصفى عشان المحاولة
الجاية تعيد التحميل بدل ما تفضل معلقة على فشل قديم. ودالة
`prewarmYoloModel()` بتستدعى عند بدء التطبيق.

## 2. هندسة الإدخال — `src/ai/yoloPostprocess.ts`

```ts
export const MODEL_INPUT_SIZE = 640;
export const NUM_ANCHORS = 8400;
export const NUM_CLASSES = 80;
export function computeLetterbox(origWidth: number, origHeight: number): LetterboxInfo;
```

النموذج بياخد صورة 640×640. الصورة الأصلية بتتصغر بنسبة واحدة وبتتحشي
بحواف (letterbox) بدل ما تتمدد، عشان أبعاد الحاجات متتشوهش — ونقدر نرجع
إحداثيات الصناديق للأصلية بدقة.

## 3. فك الخرج وقمع التكرار — `decodeYoloOutput()`

```ts
export function decodeYoloOutput(
  output: ArrayLike<number>,
  letterbox: LetterboxInfo,
  options: DecodeOptions = {},
): Detection[] {
  const confThreshold = options.confidenceThreshold ?? 0.35;
  const iouThreshold = options.iouThreshold ?? 0.45;
  const maxDetections = options.maxDetections ?? 30;
  // ...
}
```

- خرج YOLO الخام 8400 مرشح × (إحداثيات + 80 درجة فئة).
- بنرمي أي مرشح ثقته أقل من 0.35.
- وبعدين NMS بعتبة IoU 0.45: الصناديق المتداخلة لنفس الحاجة بتتدمج في
  صندوق واحد — وإلا الكرسي الواحد يتنطق ثلاث مرات.
- الناتج النهائي `Detection[]`: فئة + ثقة + صندوق إحاطة، وهو العقد اللي
  كل المستهلكين (الوصف، العوائق، المخاطر) بيشتغلوا عليه.

## 4. أرقام تتحقق منها

- ملف النموذج `assets/models/yolo11n.tflite`: ‏10,656,588 بايت،
  SHA-256 يبدأ بـ `19bfdc3c`، ترخيص AGPL-3.0.
- فئات COCO الثمانين أسماؤها في `src/ai/cocoLabels.ts` بالإنجليزي
  والعربي المنطوق.
