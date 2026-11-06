# 07 — Code Walkthrough: Risk Detection

## 1. القواعد — `src/hazards/RiskEngine.ts`

```ts
export const HAZARD_RULES: CategoryRule[] = [
  { category: 'vehicle', classes: ['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train'], threshold: 0.35 },
  { category: 'person', classes: ['person'], threshold: 0.4 },
  { category: 'animal', classes: ['dog', 'cat', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'bird'], threshold: 0.4 },
  // Sharps get a HIGHER threshold: kitchens are full of them and false
  // positives destroy trust (false-positive budget).
  { category: 'sharp', classes: ['knife', 'scissors'], threshold: 0.55 },
  { category: 'static', classes: ['chair', 'bench', 'couch', 'dining table', 'potted plant', 'bed'], threshold: 0.5 },
];
```

كل فئة COCO بتتصنف لخطر أو لا، بعتبة ثقة خاصة بها. السكاكين عتبتها
أعلى عمدًا: المطبخ مليان سكاكين، وتنبيه كاذب كل دقيقة بيقتل ثقة
المستخدم في التنبيه الحقيقي.

## 2. تقدير الخطر — `baseRisk()`

```ts
export type RiskLevel = 'low' | 'medium' | 'high';
export function baseRisk(c: Omit<HazardCandidate, 'level'>): RiskLevel;
export function extractCandidates(detections: Detection[]): HazardCandidate[];
```

الخطر مش من الفئة لوحدها: بيتركب من الفئة + القرب + الاتجاه. القرب
جاي من `src/ai/ObstacleAwareness.ts`:

```ts
export type ProximityCategory = 'near' | 'medium' | 'far';
export function proximityCategory(d: Detection): ProximityCategory;
```

وهو تقدير من حجم الصندوق في الصورة — **فئة قرب مش مسافة بالأمتار**،
والتطبيق عمره ما بيقول «على بعد مترين».

## 3. اللي مش بيتمسك — `NOT_DETECTABLE`

```ts
export const NOT_DETECTABLE = [
  { en: 'Stairs and steps', ar: 'السلالم والدرج' },
  { en: 'Holes and drop-offs', ar: 'الحفر والمنحدرات المفاجئة' },
  { en: 'Fire and smoke', ar: 'النار والدخان' },
  { en: 'Glass doors and walls', ar: 'الأبواب والحوائط الزجاجية' },
  { en: 'Weapons', ar: 'الأسلحة' },
  // + hanging obstacles, slippery floors
];
```

القائمة دي معروضة جوه التطبيق نفسه. نموذج COCO ميقدرش يشوف الحاجات
دي، وبدل ما نوهم المستخدم بتغطية مش موجودة، بنعلن الحدود.

## 4. التنبيه والإشعار — `src/hazards/HazardService.ts`

```ts
export type GuardianNotifyOutcome = 'sent' | 'failed' | 'unavailable';
export const supabaseHazardNotifier: HazardNotifier = { /* returns 'unavailable' */ };
```

التنبيه بيتنطق فورًا وبيقاطع أي كلام، وبيتسجل في سجل التنبيهات على
الجهاز. لكن إشعار الوصي بحدث كاميرا: **مش متصل بالإنتاج** — مفيش جدول
مخاطر في قاعدة البيانات، والمُشعّر بيرجع `unavailable` بصراحة. اللي
بيوصل للوصي فعلًا هو SOS اليدوي (قسم 10).
