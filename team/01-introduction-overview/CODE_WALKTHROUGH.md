# 01 — Code Walkthrough: Introduction & Overview

## 1. التطبيق بيبدأ منين؟ — `src/app/_layout.tsx`

الـ root layout هو أول حاجة بتشتغل: بيجهّز الإعدادات واللغة، ويربط خدمة
التحديثات والقياسات، وبيعمل تسخين مسبق لحاجتين تقال: أصوات الجهاز ونموذج
الكشف، عشان أول استخدام ميبقاش بطيء:

```ts
import { updateService } from '../update/UpdateService';
import { startLatencyWarmUps } from '../ai/warmUp';
```

والتسخين نفسه تعريفه في `src/ai/warmUp.ts`:

```ts
export function startLatencyWarmUps(): void {
  speechService.warmUp();
  prewarmYoloModel();
}
```

## 2. التنقل الأساسي — `src/app/(tabs)/_layout.tsx`

خمسة تبويبات رئيسية: Home وSmart Assistant وHistory وFamily وSettings.
كل الشاشات الفرعية (الكشف، القراءة، الصوت، الأماكن، التحديثات، تسجيل
الوصي) بره التبويبات وبتتفتح من جواها.

## 3. مدخل الصور قابل للاستبدال — `src/input/ImageSource.ts`

أي ميزة بتحتاج صورة بتاخدها من واجهة واحدة `ImageSource`، والمصادر
الحالية: المعرض (Gallery)، وكاميرا الهاتف كمصدر **اختبار** معلن
(PhoneCameraTest)، والنظارات الذكية كواجهة مكتوبة لكنها غير متاحة حاليًا
(typed NotAvailable) — دي شغل مستقبلي، مش ميزة شغالة:

```ts
export type ImageSourceKind = 'gallery' | 'sample' | 'phone-camera-test' | 'smart-glasses';

export interface ImageSource {
  // ...
}

export class ImageSourceNotAvailableError extends Error {}
```

الفكرة: لما النظارات توصل، مصدر جديد بيتركب مكان الحالي من غير ما أي
ميزة تتكتب من جديد.

## 4. الصورة الكبيرة

- الذكاء الاصطناعي كله **على الجهاز** (on-device): الكشف والـ OCR شغالين
  بنماذج TFLite جوه التطبيق، من غير ما الصور تتبعت لسيرفر.
- السحابة (Supabase) دورها اجتماعي/أمني بس: حسابات الأوصياء والموافقات
  والموقع الأخير وتنبيهات SOS — وده قسم 10.
- التحديثات بتوصل OTA من غير إعادة تثبيت (قسم 03).
