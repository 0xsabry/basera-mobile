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
    date: '2026-10-31',
    runtimeVersion: '1.1.0',
    titleEn: 'Critical fixes: addresses, language switching, images, voices, tab icons',
    titleAr: 'إصلاحات مهمة: العناوين وتبديل اللغة والصور والأصوات وأيقونات التنقل',
    bodyEn:
      'Location now shows a real address for your position (or honest coordinates when no address exists), marked approximate when GPS accuracy is low. Switching between Arabic and English now restarts the app safely so the whole layout flips correctly. Choosing any photo — PNG, JPEG or camera — is normalized before analysis, and failures now explain exactly what went wrong. The voice picker lists readable voices with a test button, and a voice that no longer exists can no longer silence the app. Bottom navigation icons are bolder and higher-contrast in every theme. This bundle ships in app version 1.1.1 (runtime stays 1.1.0).',
    bodyAr:
      'يعرض الموقع الآن عنوانًا حقيقيًا لموضعك (أو الإحداثيات بصراحة عند غياب العنوان)، ويُسمّى تقريبيًا عند ضعف دقة GPS. أصبح التبديل بين العربية والإنجليزية يعيد تشغيل التطبيق بأمان حتى ينعكس اتجاه الواجهة كاملًا وبشكل صحيح. أي صورة تختارها — PNG أو JPEG أو من الكاميرا — تُجهَّز قبل التحليل، والأخطاء تشرح الآن سببها بالضبط. قائمة الأصوات تعرض أسماء مقروءة مع زر اختبار، والصوت الذي لم يعد موجودًا لا يستطيع إسكات التطبيق بعد الآن. أيقونات شريط التنقل أصبحت أوضح وأعلى تباينًا في كل السمات. تصل هذه الحزمة في إصدار التطبيق 1.1.1 (يبقى إصدار وقت التشغيل 1.1.0).',
  },
  {
    date: '2026-10-31',
    runtimeVersion: '1.1.0',
    titleEn: 'Final polish: quiet icons, calmer Home, reliability fixes',
    titleAr: 'لمسة أخيرة: أيقونات هادئة ورئيسية أبسط وإصلاحات موثوقية',
    bodyEn:
      'Icons are now small and light everywhere, and Home is a calmer list led by the voice assistant. Voice commands no longer leak sessions, speech can no longer block updates, and location sharing cannot start twice at once. Wording follows the short canonical labels throughout.',
    bodyAr:
      'أصبحت الأيقونات صغيرة وخفيفة في كل مكان، والرئيسية قائمة أهدأ بقيادة المساعد الصوتي. لم تعد الأوامر الصوتية تترك جلسات عالقة، ولا يعود النطق يمنع التحديثات، ولا يمكن بدء مشاركة الموقع مرتين معًا. النصوص كلها بالتسميات القصيرة المعتمدة.',
  },
  {
    date: '2026-10-31',
    runtimeVersion: '1.1.0',
    titleEn: 'Quality overhaul: clearer design, concise wording, location map',
    titleAr: 'تحسين شامل: تصميم أوضح ونصوص مختصرة وخريطة للموقع',
    bodyEn:
      'A calmer, more distinctive interface on every screen, and shorter, clearer text in Arabic and English. Family gains a My Location view with your real phone GPS fix and an OpenStreetMap preview; the guardian web map now shows location accuracy and freshness. Guardian sharing still needs the one-time server setup by the owner — until then, the app says so honestly.',
    bodyAr:
      'واجهة أهدأ وأكثر تميزًا في كل الشاشات، ونصوص أقصر وأوضح بالعربية والإنجليزية. أضيف إلى العائلة قسم «موقعي» الذي يعرض موقع هاتفك الحقيقي مع خريطة OpenStreetMap، وأصبحت خريطة الوصي على الويب تعرض دقة الموقع وحداثته. وما تزال مشاركة الوصي تحتاج إعداد الخادم لمرة واحدة؛ وحتى يتم ذلك يوضح التطبيق الأمر بصراحة.',
  },
  {
    date: '2026-10-31',
    runtimeVersion: '1.1.0',
    titleEn: 'BASERA 1.1.0 — Premium redesign: a calmer, clearer interface',
    titleAr: 'بصيرة 1.1.0 — تصميم جديد فاخر: واجهة أهدى وأوضح',
    bodyEn:
      'A complete visual redesign of every screen: a new design system with refined light, dark and high-contrast themes, a clearer home (brand header, one voice hero, an honest smart-glasses status card, and a feature grid), segmented settings controls, grouped history, severity cards for alerts, and a mic-hero voice screen. No features changed and nothing was removed — everything works exactly as before, and all status information is still announced with text, never color alone.',
    bodyAr:
      'إعادة تصميم بصرية كاملة لكل الشاشات: نظام تصميم جديد بسمات فاتحة وداكنة وعالية التباين أكثر رقّة، وشاشة رئيسية أوضح (ترويسة بالعلامة، وزر صوتي رئيسي واحد، وبطاقة حالة صادقة للنظارة الذكية، وشبكة ميزات)، وعناصر تحكم مجزأة في الإعدادات، وسجل مجمع حسب اليوم، وبطاقات خطورة للتنبيهات، وشاشة صوت بقرص ميكروفون. لم تتغير أي ميزة ولم تُحذف أي وظيفة؛ كل شيء يعمل كما كان تمامًا، وكل معلومات الحالة تُعرض بنص، ولا يُعتمد على اللون وحده أبدًا.',
  },
  {
    date: '2026-10-30',
    runtimeVersion: '1.1.0',
    titleEn: 'BASERA 1.1.0 — New design, Places memory, danger alerts, background sharing',
    titleAr: 'بصيرة 1.1.0 — تصميم جديد، ذاكرة أماكن، تنبيهات خطر، مشاركة في الخلفية',
    bodyEn:
      'A major over-the-air update: new bottom navigation (Home, Assistance, History, Family, Settings), a redesigned home and settings, Smart Place Memory with voice commands, scan-based danger alerts with SOS, and background location sharing with an offline queue. No reinstall was needed. Everything marked unavailable in the app still needs its external setup (for example the guardian service).',
    bodyAr:
      'تحديث هوائي كبير: شريط تنقل سفلي جديد (الرئيسية، المساعد الذكي، السجل، العائلة، الإعدادات)، وإعادة تصميم للشاشتين الرئيسية والإعدادات، وذاكرة أماكن ذكية بأوامر صوتية، وتنبيهات خطر مبنية على الفحص مع استغاثة SOS، ومشاركة موقع في الخلفية مع قائمة انتظار عند عدم الاتصال. وصل التحديث دون إعادة تثبيت. وكل ما يظهر في التطبيق بصفة «غير متاح» ما يزال يحتاج إعداده الخارجي (مثل خدمة الوصي).',
  },
  {
    date: '2026-10-30',
    runtimeVersion: '1.1.0',
    titleEn: 'OTA smoke test — delivery channel verified',
    titleAr: 'اختبار التحديث الهوائي — تم التحقق من قناة التوصيل',
    bodyEn:
      'This note arrived over the air, without reinstalling the app. If you can read it in the update screen, the OTA pipeline (runtime 1.1.0, preview channel) works end to end. No features changed in this update.',
    bodyAr:
      'وصلت هذه الملحوظة عبر الهواء دون إعادة تثبيت التطبيق. إذا استطعت قراءتها في شاشة التحديثات، فخط التحديثات الهوائية (إصدار وقت التشغيل 1.1.0، قناة preview) يعمل من الطرف إلى الطرف. لم تتغير أي ميزات في هذا التحديث.',
  },
  {
    date: '2026-10-30',
    runtimeVersion: '1.1.0',
    titleEn: 'BASERA 1.1.0 — Guardian + over-the-air updates',
    titleAr: 'بصيرة 1.1.0 — الوصي + التحديثات الهوائية',
    bodyEn:
      'This app build adds the over-the-air update system (future fixes arrive without reinstalling) and guardian location sharing (foreground only, with your explicit approval for every guardian). Background tracking and live hazard alerts are NOT in this build.',
    bodyAr:
      'تضيف هذه النسخة نظام التحديثات الهوائية (تصل الإصلاحات القادمة دون إعادة تثبيت) ومشاركة الموقع مع الوصي (في الواجهة فقط، وبموافقتك الصريحة على كل وصي). في هذه النسخة تحديدًا، لم يكن التتبع في الخلفية وتنبيهات الخطر المباشرة متاحين بعد.',
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
