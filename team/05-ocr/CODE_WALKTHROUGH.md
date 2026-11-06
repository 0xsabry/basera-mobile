# 05 — Code Walkthrough: OCR

## 1. محركان بعقد واحد — `src/ai/TextRecognizer.ts`

```ts
export class RoutingTextRecognizer implements TextRecognizer {
  readonly id = 'routing-ocr';
  constructor(
    private readonly preferred: 'ar' | 'en',
    engines?: { latin: TextRecognizer; arabic: TextRecognizer },
  ) { /* ... */ }

  async recognize(image: CapturedImage): Promise<OcrResult> {
    // Normalize before routing (default engines only).
    const img = this.usesDefaultEngines ? await normalizeImage(image) : image;
    const order = /* preferred engine first, other as fallback */;
  }
}
```

- واجهة التطبيق عربي → محرك PP-OCR الأول. إنجليزي → ML Kit الأول.
- لو الأول رجع فاضي أو فشل، التاني بيجرب (cross-fallback).
- التوحيد بيحصل مرة واحدة هنا لأن محرك PP-OCR معندوش توحيد خاص به.

## 2. خط الأنابيب العربي — `src/ai/ArabicOcrEngine.ts`

```ts
export const DET_CANVAS = 960;   // detection input canvas
export const REC_H = 48;         // recognition line height
export const REC_W = 640;        // recognition line width
export const REC_CLASSES = 163;  // 161 chars + blank + space
```

المراحل: نموذج الكشف (detection) بيلاقي صناديق النص في الصورة →
`extractTextBoxes()` بترتبها سطور → كل سطر بيتصغر لـ 48×640 ويدخل
نموذج التعرف → درجات لكل خطوة زمنية ولكل فئة من الـ 163.

## 3. فك CTC — `ctcGreedyDecode()`

```ts
export function ctcGreedyDecode(logits: ArrayLike<number>, timesteps: number): string {
  let out = '';
  let prev = -1;
  for (let t = 0; t < timesteps; t++) {
    // pick the best class at this timestep
    if (best !== prev && best !== 0) {           // 0 = CTC blank
      if (best === REC_CLASSES - 1) out += ' ';  // last class = space
      else if (best - 1 < ARABIC_OCR_CHARS.length) out += ARABIC_OCR_CHARS[best - 1];
    }
    prev = best;
  }
}
```

فكرة CTC: النموذج بيطلع حرف لكل خطوة زمنية، مع تكرارات وفواصل فارغة
(blank). الفك الجشع بياخد الأعلى كل مرة، وبيشيل التكرار المتتالي
والفراغات — فتطلع الجملة النهائية.

## 4. أمانة في الحدود

- الحروف المنقطة (ب/ت/ث، ج/ح/خ) بتتلخبط أحيانًا في العربي — قيد معروف
  ومتوثق، ومبيتغطاش عليه.
- النص المقروء بيتنطق **حرفيًا**؛ قواعد السرد اللي بتختصر وصف الصور
  ممنوعة تلمس نص OCR أو أسماء أو أكواد.
