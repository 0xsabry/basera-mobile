# 03 — Code Walkthrough: Expo & Mobile Development

## 1. إعدادات التطبيق — `app.json`

```json
{
  "scheme": "basera",
  "version": "1.1.8",
  "runtimeVersion": "1.1.0"
}
```

- الـ `runtimeVersion` عندنا **سلسلة يدوية** مش رقم تلقائي: أي تحديث OTA
  لازم يطابقها عشان يوصل لنفس جيل التطبيق المثبت.
- رقم النسخة الحقيقي للأندرويد (versionName 1.1.8 / versionCode 10)
  مصدره `android/app/build.gradle` لأن المشروع bare workflow — ودي نقطة
  اتلخبطنا فيها زمان واتحلت بتوثيقها في `docs/RELEASE.md`.

## 2. بروفايلات البناء — `eas.json`

```json
"preview":    { "distribution": "internal", "channel": "preview" },
"production": { "distribution": "internal", "channel": "production" },
"telemetry-smoke": { "channel": "telemetry-smoke" }
```

قناة `preview` هي سقف النشر العادي. قناة `production` موجودة في
الإعدادات لكن لم تُستخدم.

## 3. خدمة التحديث — `src/update/UpdateService.ts`

```ts
export type UpdateCheckResult = /* ... */;
export type UpdateFetchResult = /* ... */;
export type UpdatePhase = /* ... */;
export interface UpdateStatus { /* ... */ }
export type UpdatesFacadeMatchesSdk = ExpectTrue< /* SDK shape guard */ >;
```

درس مهم حصل فعلًا: الـ OTA كان ميت من أول يوم لأن الكود كان بيقرأ حقل
`isUpdateAvailable` بينما الـ SDK بيرجع `isAvailable`. الإصلاح اتعمل،
واتبنى فوقه حارس نوع وقت الترجمة (`ExpectTrue`) عشان الشكل لو اتغير
التجميع يقف بدل ما الميزة تموت بصمت.

## 4. حارس الإصدار — `scripts/release-guard.mjs`

قبل أي نشر: `node scripts/release-guard.mjs ota` بيتأكد من الـ runtime،
فصل القنوات، سلم أرقام النسخ، وإن مفيش تغيير native من آخر APK. لو أي
شرط سقط، النشر يقف.

## 5. بدء التشغيل — `src/app/_layout.tsx`

```ts
import { startLatencyWarmUps } from '../ai/warmUp';
// on mount:
startLatencyWarmUps();
```

التسخين بيجهز الأصوات ونموذج YOLO في الخلفية من غير ما يطلع صوت أو
واجهة — أول كشف وأول جملة منطوقة ميدفعوش تمن التحميل.
