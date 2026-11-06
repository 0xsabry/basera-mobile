# 08 — Code Walkthrough: Places & GPS

## 1. التخزين على الجهاز — `src/places/PlacesStore.ts`

```ts
export const MAX_PLACES = 200;
export class PlacesStore {
  constructor(private readonly storage: PlacesStorage = /* AsyncStorage */) {}
}
export const placesStore = new PlacesStore();
```

الأماكن (اسم، فئة، إحداثيات، تنبيه قرب أو لا) بتتخزن على الجهاز.
المزامنة اختيارية وبحساب المستخدم نفسه بس — والنص المرسل للمستخدم
بيقولها صراحة في `placesSyncExpl`: «تبقى الأماكن على هذا الجهاز ما لم
تفعّل المزامنة بحسابك. لا يمكن للأوصياء الاطلاع على أماكنك المحفوظة
أبدًا.» ونتيجة المزامنة نوعها صريح:

```ts
export type PlacesSyncOutcome = 'synced' | 'unconfigured' | 'signed-out' | 'failed';
```

## 2. الموقع الحالي من غير كذب — `src/places/currentFix.ts`

```ts
export type FixError = 'permission' | 'unavailable';
export async function getCurrentFix(requestIfNeeded = true): Promise<FixResult>;
export async function getFixIfPermitted(): Promise<FixResult>;
```

مفيش موقع وهمي: لو الإذن مرفوض النتيجة `permission`، ولو الـ GPS مش
متاح `unavailable` — والواجهة بتقول السبب. والدالة التانية مبتطلبش
إذن أصلًا، للمواضع اللي الطلب فيها مش مناسب.

## 3. من إحداثيات لعنوان منطوق — `src/places/geocode.ts`

سلسلة بدائل مرتبة: Nominatim أولًا (بهوية معلنة
`BASERA/1.1 (me.auramarketing.basera)`، وتخزين مؤقت في خلية ~100 متر
وحد أدنى 1.1 ثانية بين الطلبات احترامًا لسياسة الخدمة) → مكود الجهاز
→ إحداثيات فقط مع إعلان إن مفيش عنوان. ولو دقة الإصلاح أضعف من 100
متر، العنوان بيتلقب «تقريبي».

## 4. تنبيه القرب — `src/places/proximityCore.ts`

```ts
export const PROXIMITY_COOLDOWN_MS = 30 * 60 * 1000;
export function checkProximity(
  fix: GeoFix,
  places: Place[],
  opts: { radiusM: number; lastNotifiedAt: Record<string, number>; now: number; cooldownMs?: number },
): ProximityHit[] {
  return places
    .filter((p) => p.proximityEnabled)
    .map((place) => ({ place, distanceM: haversineMeters(fix, place) }))
    .filter((h) => h.distanceM <= opts.radiusM)
    .filter((h) => { /* 30-min per-place cooldown */ })
    .sort((a, b) => a.distanceM - b.distanceM);
}
```

لاحظ الفرق: هنا المسافة بالأمتار **حقيقية** لأنها محسوبة من إحداثيات
GPS فعلية (Haversine) — عكس قرب الصورة في قسم 07 اللي هو فئة تقديرية.
