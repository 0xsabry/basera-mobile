/**
 * Release notes for OTA updates (V1.1 Phase 0).
 *
 * The text passed to `eas update --message` is NOT reliably available to
 * the running app, so release notes live HERE: a versioned, in-bundle
 * source of truth. Every OTA publish MUST add/adjust an entry in the same
 * change that ships the code, keyed by the date + runtime version
 * (appVersion policy → runtimeVersion === app version). Because the notes
 * ship inside the JS bundle, the notes an installation displays are
 * exactly the notes of the bundle it is running.
 */
export interface ReleaseNote {
  /** ISO date (YYYY-MM-DD) of the update that shipped these notes. */
  date: string;
  /** Runtime version (app version) the notes belong to. */
  runtimeVersion: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

/** Newest first. */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    date: '2026-10-30',
    runtimeVersion: '1.1.0',
    titleEn: 'BASERA 1.1.0 — New design, Places memory, danger alerts, background sharing',
    titleAr: 'بصيرة 1.1.0 — تصميم جديد، ذاكرة أماكن، تنبيهات خطر، مشاركة في الخلفية',
    bodyEn:
      'A major over-the-air update: new bottom navigation (Home, Assistance, History, Family, Settings), a redesigned home and settings, Smart Place Memory with voice commands, scan-based danger alerts with SOS, and background location sharing with an offline queue. No reinstall was needed. Everything marked unavailable in the app still needs its external setup (for example the guardian service).',
    bodyAr:
      'تحديث هوائي كبير: تنقل سفلي جديد (الرئيسية، المساعدة، السجل، العائلة، الإعدادات)، إعادة تصميم للرئيسية والإعدادات، ذاكرة أماكن ذكية بأوامر صوتية، تنبيهات خطر على اللقطات مع استغاثة SOS، ومشاركة موقع في الخلفية مع قائمة انتظار دون اتصال. من غير إعادة تثبيت. أي حاجة مكتوب عليها غير متاحة في التطبيق لسه محتاجة إعدادها الخارجي (زي خدمة الوصي).',
  },
  {
    date: '2026-10-30',
    runtimeVersion: '1.1.0',
    titleEn: 'OTA smoke test — delivery channel verified',
    titleAr: 'اختبار التحديث الهوائي — تم التحقق من قناة التوصيل',
    bodyEn:
      'This note arrived over the air, without reinstalling the app. If you can read it in the update screen, the OTA pipeline (runtime 1.1.0, preview channel) works end to end. No features changed in this update.',
    bodyAr:
      'الملحوظة دي وصلت عبر الهواء، من غير إعادة تثبيت التطبيق. لو قادر تقراها في شاشة التحديثات، يبقى خط التحديثات الهوائية (runtime 1.1.0، قناة preview) شغال من الطرف للطرف. مفيش مزايا اتغيرت في التحديث ده.',
  },
  {
    date: '2026-10-30',
    runtimeVersion: '1.1.0',
    titleEn: 'BASERA 1.1.0 — Guardian + over-the-air updates',
    titleAr: 'بصيرة 1.1.0 — الوصي + التحديثات الهوائية',
    bodyEn:
      'This app build adds the over-the-air update system (future fixes arrive without reinstalling) and guardian location sharing (foreground only, with your explicit approval for every guardian). Background tracking and live hazard alerts are NOT in this build.',
    bodyAr:
      'النسخة دي بتضيف نظام التحديثات الهوائية (الإصلاحات الجاية توصلك من غير إعادة تثبيت) ومشاركة الموقع مع الوصي (في الواجهة بس، وبموافقتك الصريحة على كل وصي). التتبع في الخلفية وتنبيهات الخطر المباشرة مش موجودة في النسخة دي.',
  },
];

/** Notes for the bundle currently running (the newest entry — notes are
 *  baked into the bundle, so the newest entry describes this bundle). */
export function currentReleaseNote(): ReleaseNote | null {
  return RELEASE_NOTES[0] ?? null;
}

export function releaseNotesForRuntime(runtimeVersion: string | null): ReleaseNote[] {
  if (!runtimeVersion) return RELEASE_NOTES;
  const matching = RELEASE_NOTES.filter((n) => n.runtimeVersion === runtimeVersion);
  return matching.length > 0 ? matching : RELEASE_NOTES;
}
