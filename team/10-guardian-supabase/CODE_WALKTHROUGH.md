# 10 — Code Walkthrough: Guardian & Supabase

## 1. الموافقة بتتوزع على كل الروابط — `src/guardian/GuardianService.ts`

```ts
async setSharingEnabled(enabled: boolean): Promise<void> {
  const uid = await this.requireUserId();
  try {
    await this.setConsentOnAllMyLinks({ locationSharingEnabled: enabled });
    if (!enabled) {
      // Privacy contract: consent off => the stored latest location
      // is deleted, not merely hidden.
      await gw.deleteLatestLocation(this.client, uid);
    }
  } catch (e) {
    throw toServiceError(e);
  }
}
```

مفيش مفتاح موافقة عام: الموافقة محفوظة **على كل رابط وصي** في جدول
`guardian_links`، والخدمة بتوزع التغيير عليهم. والإيقاف مش إخفاء —
بيحذف آخر موقع مخزن.

## 2. ليه زرار SOS كان ساكت — `src/app/(tabs)/family.tsx`

```ts
const toggleSos = async (on: boolean) => {
  if (busy) return;
  if (on && guardians.length === 0) {
    // The consent fan-out runs per guardian link; with none linked
    // the switch used to flip and silently stay off. Say why.
    setMessage(t(lang, 'guardianSosNeedsGuardian'));
    return;
  }
  await service.setSosSharingEnabled(on);
  const consent = await service.getConsent().catch(() => null);
  if (consent) setSosOn(consent.sosSharingEnabled);
};
```

نفس منطق التوزيع: من غير أوصياء مربوطين، مفيش حد تتكتب له الموافقة،
فالزرار كان بيرجع مطفي من غير تفسير. الإصلاح (اتنشر OTA) بيقول السبب
بدل السكوت.

> دليل النشر: التصحيح ده ضمن كوميت `aa1dcd2` اللي اتنشر على قناة
> المعاينة في مجموعة التحديث `89ca0bf0-e6eb-45f1-93c9-253d658efdd7`
> (تحديث Android `01a1b253-7b7b-763b-b1e8-f4c2ae128f5d`)، وبوابة
> القبول اتحققت منها (32/32 بصمة ملفات + النصوص الجديدة ظاهرة في
> الحزمة المخدومة). تطبيق التحديث على جهاز فعلي لسه مش مثبت.

## 3. إنشاء الدعوة من العميل — `src/guardian/supabaseGateway.ts`

```ts
export async function createInvite(
  client: GatewayClient,
  invitedEmail: string,
): Promise<Invite> {
  const { data, error } = await client.functions.invoke(DEPLOYED.functions.createInvite, {
    body: { invited_email: invitedEmail },
  });
  if (error) throw await extractFunctionError(error);
  return parseInvitePayload(data);
}
```

العميل بيبعت بريد المدعو، و`parseInvitePayload` بيقرأ من الرد
`invitedEmail` و`boundToEmail`. مع الدالة **المنشورة حاليًا** الحقل
بيتتجاهل و`boundToEmail` بيفضل false — والواجهة ممنوعة تدّعي الربط
إلا لو true. الربط الفعلي موجود في النسخة المرشحة
(`supabase/functions/`) ولسه مش منشور.

## 4. أخطاء بقصد التصميم

- أي فشل في قبول الدعوة — منتهية، مستخدمة، مزيفة، أو بريد غير مطابق
  في المرشحة — بيرجع نفس الرسالة `invalid_or_expired_invite` عشان
  ميتسربش سبب الفشل لمهاجم بيخمّن.
- أخطاء المصادقة لها رسائل مخصوصة في الواجهة: حد الإرسال
  (`over_email_send_rate_limit`) وعدم تأكيد البريد
  (`email_not_confirmed`) مش «خطأ عام».
- دور الزائر (anon) صلاحياته على الجداول **صفر** — الوصول كله
  بسياسات RLS ودوال الحافة.
