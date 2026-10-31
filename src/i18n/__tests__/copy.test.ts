/**
 * Copy guardrails for BASERA microcopy (see docs/COPY.md).
 *
 * These tests keep the UI text professional and concise in both languages:
 * key parity, label length budgets, no Egyptian-dialect vocabulary in the
 * Arabic UI, consistent terminology, no known-false claims, and a length
 * budget for the long explanation strings.
 */
import { RELEASE_NOTES } from '../../update/releaseNotes';
import { STRINGS, type StringKey } from '../strings';

const en = STRINGS.en;
const ar = STRINGS.ar;

/** Button-like labels: 1–3 words, must fit comfortably on a control. */
const LABEL_KEYS: StringKey[] = [
  'start',
  'skip',
  'detect',
  'readText',
  'voice',
  'voiceAssistance',
  'places',
  'history',
  'settings',
  'family',
  'assistance',
  'home',
  'saveAction',
  'delete',
  'cancel',
  'confirm',
  'repeat',
  'stopSpeaking',
  'stopListening',
  'guardianSignIn',
  'guardianSignUp',
  'guardianSignOut',
  'guardianRevoke',
  'guardianCreateCode',
  'sosButton',
  'iAmOk',
  'updateCheckNow',
  'updateRestart',
  'refreshLocation',
  'placesEdit',
  'placesMarkVisited',
  'placesListen',
  'placesSyncNow',
  'guardianDeletionRetry',
  'openSystemSettings',
  'requestPermission',
  'viewAlerts',
  'clearAll',
  'bgTrackingEnable',
  'bgTrackingDisable',
  'guardianOpenSignIn',
];

/** Long explanations: at most two short sentences of material fact. */
const EXPLANATION_KEYS: StringKey[] = [
  'guardianSharingExpl',
  'guardianPairingExpl',
  'bgTrackingExpl',
  'placesProximityExpl',
  'placesSyncExpl',
  'onboardingBody',
  'onboardingGlassesNote',
  'privacyBody',
  'sosExpl',
  'alertsBlindSpotsBody',
];

/** Egyptian-dialect vocabulary banned from the Arabic UI (MSA only). */
const FORBIDDEN_AR_TERMS = [
  'عينك الذكية',
  'شوف العالم',
  'لسه',
  'عايز',
  'دوس',
  'كده',
  'عشان',
  'أوي',
  'يلا',
  // v1.1.2 overhaul: strings that shipped in dialect before this pass
  // (spoken welcome/OCR prefix, old release-note bodies, voice examples).
  'بيقول',
  'مفيش',
  'اختار اللي',
  'اللي تحب',
  'اتشالت',
  'اتغيرت',
  'زي ما هي',
  'شغالة',
  'المكان ده',
  'فين الجامعة',
  'إيه الأماكن',
  'ايه اللي قدامي',
];

/** Standalone dialect negation «مش» as its own word. */
const DIALECT_NEGATION = /(?:^|\s)مش(?:\s|$|[،.:؛!؟])/u;

/** A claim that was false (background tracking exists) and must never return. */
const FALSE_CLAIM = /not in this version|مش موجود في النسخة/;

describe('copy: key parity and non-empty values', () => {
  it('AR and EN expose exactly the same keys', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('no value is empty or whitespace-only in either language', () => {
    const empty: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      if (value.trim().length === 0) empty.push(`en.${key}`);
    }
    for (const [key, value] of Object.entries(ar)) {
      if (value.trim().length === 0) empty.push(`ar.${key}`);
    }
    expect(empty).toEqual([]);
  });
});

describe('copy: label length budgets', () => {
  it('button labels fit AR ≤ 28 chars and EN ≤ 32 chars', () => {
    const tooLong: string[] = [];
    for (const key of LABEL_KEYS) {
      if (ar[key].length > 28) tooLong.push(`ar.${key} (${ar[key].length}): ${ar[key]}`);
      if (en[key].length > 32) tooLong.push(`en.${key} (${en[key].length}): ${en[key]}`);
    }
    expect(tooLong).toEqual([]);
  });
});

describe('copy: no dialect, no false claims', () => {
  it('no Arabic value contains banned dialect or promotional terms', () => {
    const hits: string[] = [];
    for (const [key, value] of Object.entries(ar)) {
      for (const term of FORBIDDEN_AR_TERMS) {
        if (value.includes(term)) hits.push(`ar.${key} contains "${term}"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('no Arabic value uses the standalone dialect negation «مش»', () => {
    const hits: string[] = [];
    for (const [key, value] of Object.entries(ar)) {
      if (DIALECT_NEGATION.test(value)) hits.push(`ar.${key}: ${value}`);
    }
    expect(hits).toEqual([]);
  });

  it('neither language claims an existing feature is "not in this version"', () => {
    const hits: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      if (FALSE_CLAIM.test(value)) hits.push(`en.${key}`);
    }
    for (const [key, value] of Object.entries(ar)) {
      if (FALSE_CLAIM.test(value)) hits.push(`ar.${key}`);
    }
    expect(hits).toEqual([]);
  });

  it('guardian location note tells the truth about background tracking', () => {
    expect(en.guardianLocationNote).toContain('background tracking is optional');
    expect(ar.guardianLocationNote).toContain('التتبع في الخلفية اختياري');
    expect(en.guardianLocationNote).toContain("phone's location");
    expect(ar.guardianLocationNote).toContain('موقع هاتفك');
  });
});

describe('copy: terminology spot checks', () => {
  it('uses the fixed terminology from docs/COPY.md', () => {
    expect(ar.detect).toContain('وصف');
    expect(ar.readText).toContain('النص');
    expect(ar.places).toBe('أماكني المحفوظة');
    expect(ar.guardian).toContain('الوصي');
    expect(ar.tagline).toBe('المساعد الذكي');
    expect(en.tagline).toBe('Smart Assistant');
    expect(ar.homeGreeting).toBe('ما الذي تحتاج إليه؟');
    expect(en.homeGreeting).toBe('What do you need?');
    expect(ar.glassesCardStatus).toBe('النظارة غير متصلة');
    expect(ar.modeReady).toBe('جاهز');
  });

  it('new My Location keys carry the agreed values', () => {
    expect(en.myLocation).toBe('My location');
    expect(ar.myLocation).toBe('موقعي');
    expect(en.refreshLocation).toBe('Update location');
    expect(ar.refreshLocation).toBe('تحديث الموقع');
    expect(en.fixAgeNow).toBe('just now');
    expect(ar.fixAgeNow).toBe('الآن');
    expect(en.fixAgeOneMinute).toBe('1 minute ago');
    expect(ar.fixAgeOneMinute).toBe('قبل دقيقة');
    expect(en.fixAgeFewMinutes).toBe('a few minutes ago');
    expect(ar.fixAgeFewMinutes).toBe('قبل بضع دقائق');
    expect(en.mapAttribution).toBe('© OpenStreetMap contributors');
    expect(ar.mapAttribution).toBe('© OpenStreetMap contributors');
    expect(en.phoneLocationSource).toBe('Phone location');
    expect(ar.phoneLocationSource).toBe('موقع الهاتف');
  });
});

describe('copy: canonical strings (owner-mandated exact wording)', () => {
  it('the 7 canonical Arabic strings match exactly', () => {
    expect(ar.homeGreeting).toBe('ما الذي تحتاج إليه؟');
    expect(ar.voiceAssistance).toBe('المساعد الصوتي');
    expect(ar.detect).toBe('وصف المشهد');
    expect(ar.readText).toBe('قراءة النص');
    expect(ar.places).toBe('أماكني المحفوظة');
    expect(ar.guardianSharing).toBe('مشاركة الموقع');
    expect(ar.glassesCardStatus).toBe('النظارة غير متصلة');
  });

  it('canonical English counterparts stay as agreed', () => {
    expect(en.voiceAssistance).toBe('Voice assistant');
    expect(en.detect).toBe('Describe surroundings');
    expect(en.places).toBe('Saved places');
    // Persona/action labels are distinct from the feature noun and stay.
    expect(ar.voice).toBe('المساعد الصوتي');
    expect(en.voice).toBe('Voice assistant');
  });
});

describe('copy: the assistant has ONE name (owner order, v1.1.2)', () => {
  it('the AI assistant feature is named «المساعد الذكي» / "Smart Assistant"', () => {
    expect(ar.assistance).toBe('المساعد الذكي');
    expect(en.assistance).toBe('Smart Assistant');
    expect(ar.tagline).toBe('المساعد الذكي');
    expect(en.tagline).toBe('Smart Assistant');
  });

  it('no Arabic string uses the retired feature label «المساعدة»', () => {
    // The word was retired as the assistant's name. Generic help/support
    // uses may return ONLY by adding the key to this allowlist with a
    // justification — never by re-naming the feature.
    const ALLOWLIST: StringKey[] = [];
    const hits: string[] = [];
    for (const [key, value] of Object.entries(ar)) {
      if (value.includes('المساعدة') && !ALLOWLIST.includes(key as StringKey)) {
        hits.push(`ar.${key}: ${value}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('spoken strings are MSA and short', () => {
    expect(ar.welcomeSpoken).toBe('مرحبًا بك في بصيرة. اختر ما تريد من الشاشة الرئيسية.');
    expect(ar.ocrSpokenPrefix).toBe('يقول النص:');
    expect(ar.backToHistory).toBe('العودة إلى السجل');
  });
});

describe('copy: release notes obey the same language rules', () => {
  it('no release-note Arabic field contains banned dialect or the retired label', () => {
    const hits: string[] = [];
    for (const note of RELEASE_NOTES) {
      for (const field of ['titleAr', 'bodyAr'] as const) {
        const value = note[field];
        for (const term of FORBIDDEN_AR_TERMS) {
          if (value.includes(term)) hits.push(`${note.date}.${field} contains "${term}"`);
        }
        if (DIALECT_NEGATION.test(value)) hits.push(`${note.date}.${field} uses «مش»`);
        if (value.includes('المساعدة')) hits.push(`${note.date}.${field} uses «المساعدة»`);
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('copy: explanation length budgets', () => {
  it('long explanations stay within AR ≤ 220 chars and EN ≤ 260 chars', () => {
    const tooLong: string[] = [];
    for (const key of EXPLANATION_KEYS) {
      if (ar[key].length > 220) tooLong.push(`ar.${key} (${ar[key].length})`);
      if (en[key].length > 260) tooLong.push(`en.${key} (${en[key].length})`);
    }
    expect(tooLong).toEqual([]);
  });
});
