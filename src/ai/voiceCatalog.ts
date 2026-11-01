/**
 * Voice catalog curation (Bug 4) — PURE, no expo imports.
 *
 * The raw device voice list (expo-speech getAvailableVoicesAsync) is
 * unusable as a picker directly: entries carry raw engine IDs as names
 * (e.g. 'ar-xa-x-ser-network'), duplicates, and locales the app cannot
 * use. curateVoices() turns that list into two clean groups (Arabic /
 * English) of CuratedVoice entries the Settings UI can render as rows.
 *
 * A CuratedVoice deliberately carries NO display label: the UI composes
 * the localized label from the voiceAvailableAr / voiceAvailableEn
 * strings plus `engineHint` when one could be extracted safely:
 *
 *   label = t(lang, lang === 'ar' ? 'voiceAvailableAr' : 'voiceAvailableEn')
 *         + (engineHint ? ` · ${engineHint}` : '')
 *
 * Raw identifiers / code-like names are NEVER surfaced as hints — a
 * blind user hearing 'ar-xa-x-ser-network' learns nothing from it.
 */

/** Structural subset of expo-speech's Voice — no expo import needed. */
export interface VoiceLike {
  identifier: string;
  name: string;
  language: string;
  quality?: string;
}

export type VoiceGroupLang = 'ar' | 'en';

export interface CuratedVoice {
  identifier: string;
  lang: VoiceGroupLang;
  /**
   * Human-distinguishable hint, or null when none could be extracted
   * safely (raw-ID / code-like names). Currently the only recognized
   * engine brand is Google TTS, whose voices are common on Android and
   * worth distinguishing from the OEM engine's voices.
   */
  engineHint: string | null;
}

export interface CuratedVoices {
  ar: CuratedVoice[];
  en: CuratedVoice[];
}

/** Preferred exact locale per group, sorted first. */
const PREFERRED_LOCALE: Record<VoiceGroupLang, string> = {
  ar: 'ar-eg',
  en: 'en-us',
};

export function normalizeVoiceLanguage(raw: string | undefined | null): string {
  return (raw ?? '').replace(/_/g, '-').trim().toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Voice preference + automatic Egyptian selection                     */
/*                                                                     */
/* The preference is a three-state value, NOT a bare identifier, so  */
/* "the user never chose" (auto), "the user explicitly chose the     */
/* system default" (system) and "the user chose this voice" (custom) */
/* can never be confused with each other — a bare null could not     */
/* distinguish the first two, and treating an explicit system choice */
/* as uninitialized would silently overwrite it later.               */
/* ------------------------------------------------------------------ */

export type VoicePreference =
  | { kind: 'auto' }
  | { kind: 'system' }
  | { kind: 'custom'; identifier: string };

/** The ONLY locale accepted as a confirmed Egyptian voice. */
const EGYPTIAN_LOCALE = 'ar-eg';

/** expo-speech quality: 'Enhanced' beats everything else ('Default'…). */
function qualityTier(quality: string | undefined | null): number {
  return (quality ?? '').trim().toLowerCase() === 'enhanced' ? 0 : 1;
}

/**
 * Pick the device's Egyptian Arabic voice, or null when none exists.
 *
 * EXACT locale match only (after normalization, so 'ar_EG' counts):
 * 'ar-SA', 'ar-XA' and bare 'ar' are NOT Egyptian and are never
 * selected here — passing one off as Egyptian would be a false claim
 * about what the user hears. Among exact matches, Enhanced quality
 * wins; remaining ties break by identifier so the choice is fully
 * deterministic for a given device voice list.
 */
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

/**
 * Resolve a preference to the voice identifier an utterance should
 * use (null = no voice passed; the engine falls back to the language
 * tag). 'auto' affects Arabic only: English keeps its established
 * behavior (system default unless the user picked a custom voice).
 * When no exact Egyptian voice exists, auto resolves to null — the
 * ar-EG language fallback still applies, and speech keeps working.
 */
export function resolveVoiceIdentifier(
  pref: VoicePreference,
  voices: VoiceLike[],
  lang: VoiceGroupLang,
): string | null {
  if (pref.kind === 'custom') return pref.identifier;
  if (pref.kind === 'system') return null;
  if (lang !== 'ar') return null;
  return selectEgyptianVoice(voices)?.identifier ?? null;
}

function groupOf(normalizedLang: string): VoiceGroupLang | null {
  const primary = normalizedLang.split('-')[0];
  if (primary === 'ar') return 'ar';
  if (primary === 'en') return 'en';
  return null;
}

/**
 * Extract a human hint from a voice name, or null when the name is a
 * raw engine ID / code-like string that must never be shown.
 */
function engineHintFor(name: string, identifier: string): string | null {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;
  // Google TTS voices: the brand is the useful distinguishing fact.
  if (/google/i.test(trimmed)) return 'Google';
  // Raw-ID patterns: the name IS the identifier, an Android voice-pack
  // code ('ar-xa-x-ser-network' contains '-x-'), or a mostly code-like
  // token (digits / underscores / hashes, or a hyphenated code with no
  // spaces at all, e.g. 'en-us-x-sfg-local').
  if (trimmed === identifier) return null;
  if (trimmed.includes('-x-')) return null;
  if (/[_\d#]/.test(trimmed)) return null;
  if (!trimmed.includes(' ') && trimmed.includes('-')) return null;
  // Anything else without a recognized brand gives no SAFE hint: a
  // free-form OEM name is not shown verbatim either, because on real
  // devices those names are frequently half-localized engine strings.
  return null;
}

export function curateVoices(voices: VoiceLike[]): CuratedVoices {
  const groups: Record<VoiceGroupLang, { voice: CuratedVoice; locale: string }[]> = {
    ar: [],
    en: [],
  };
  const seenIdentifiers = new Set<string>();
  const seenNameLang = new Set<string>();

  for (const v of voices ?? []) {
    const identifier = (v?.identifier ?? '').trim();
    if (!identifier) continue; // DROP empty identifiers — cannot be selected.
    if (seenIdentifiers.has(identifier)) continue; // DEDUPE by identifier.
    const locale = normalizeVoiceLanguage(v.language);
    const group = groupOf(locale);
    if (!group) continue; // Keep only ar / en voices.
    seenIdentifiers.add(identifier);

    // Dedupe name+language duplicates (same voice listed twice under
    // different identifiers by some engines), keeping the first.
    const nameKey = `${(v.name ?? '').trim().toLowerCase()}|${locale}`;
    if ((v.name ?? '').trim() && seenNameLang.has(nameKey)) continue;
    seenNameLang.add(nameKey);

    groups[group].push({
      voice: { identifier, lang: group, engineHint: engineHintFor(v.name ?? '', identifier) },
      locale,
    });
  }

  const finish = (list: { voice: CuratedVoice; locale: string }[], group: VoiceGroupLang) =>
    list
      // Stable sort: exact preferred locale (ar-EG / en-US) first,
      // original device order preserved within each tier.
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        const rank = (loc: string) => (loc === PREFERRED_LOCALE[group] ? 0 : 1);
        return rank(a.entry.locale) - rank(b.entry.locale) || a.index - b.index;
      })
      .map(({ entry }) => entry.voice);

  return { ar: finish(groups.ar, 'ar'), en: finish(groups.en, 'en') };
}
