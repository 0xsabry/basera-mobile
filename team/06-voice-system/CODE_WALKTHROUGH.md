# 06 — Code Walkthrough: Voice System

## 1. اختيار الصوت المصري — `src/ai/voiceCatalog.ts`

```ts
export function selectEgyptianVoice(voices: VoiceLike[]): VoiceLike | null {
  const exact = (voices ?? []).filter(
    (v) =>
      v &&
      typeof v.identifier === 'string' &&
      v.identifier.trim() !== '' &&
      normalizeVoiceLanguage(v.language) === EGYPTIAN_LOCALE,
  );
  if (exact.length === 0) return null;
  return [...exact].sort(
    (a, b) => qualityTier(a.quality) - qualityTier(b.quality) || a.identifier.localeCompare(b.identifier),
  )[0];
}
```

القاعدة: تطابق **تام** مع `ar-EG` بعد التطبيع — مش أي صوت عربي وخلاص.
ولو مفيش صوت مصري على الجهاز، الدالة بترجع null والنطق بيكمل بـ
language fallback بتاع `ar-EG` بدل ما يقف. تفضيل المستخدم ثلاث حالات:
`auto` (اختيار مصري تلقائي) / `system` / `custom` بصوت محدد.

## 2. مشكلة البطء وإصلاحها — `src/ai/SpeechService.ts` + `warmUp.ts`

كانت أول جملة في الجلسة تستنى تحميل قائمة أصوات الجهاز كاملة من غير
حد أقصى، وكل جملة تدفع تمن `Speech.stop()` حتى لو مفيش حاجة شغالة.
الإصلاح:

- اكتشاف الأصوات بيبدأ عند بدء التطبيق من `src/ai/warmUp.ts`:

```ts
export function startLatencyWarmUps(): void {
  speechService.warmUp();
  prewarmYoloModel();
}
```

- ولو جت جملة قبل ما الاكتشاف يخلص، بتسابق مهلة **300 مللي ثانية**:
  بتتكلم ببديل اللغة على طول، والصوت المكتشف بيطبق من الجملة اللي
  بعدها.
- ومتعقب `speechActive` بيخلي `stop()` تتخطى لما الصوت ساكت أصلًا —
  والمقاطعة لتنبيهات الخطر لسه فورية لما فيه كلام شغال.

## 3. بناء السرد — `src/ai/DescriptionBuilder.ts`

بيحوّل الكشوفات لجمل منطوقة باتجاهات مصرية («على شمالك»، «قدامك»،
«على يمينك») وافتتاحية «شايف:». الصياغة دي للسرد بس؛ نص الـ OCR
والأسماء والأرقام بتتنطق حرفيًا وممنوع تتغير.

## 4. الأوامر الصوتية — `src/ai/VoiceCommandService.ts`

```ts
export const COMMAND_REGISTRY: VoiceCommand[] = [ /* fixed AR+EN phrases */ ];
export function parseVoiceCommand(raw: string): ParsedCommand;
```

مفيش فهم حر: الكلام المتعرف عليه بيطابق سجل أوامر ثابت، وأي حاجة بره
السجل بتترفض برسالة واضحة بدل تخمين خطير.
