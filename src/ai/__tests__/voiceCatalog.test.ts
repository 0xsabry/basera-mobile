/**
 * Bug 4: curateVoices turns the raw device voice list — raw engine IDs,
 * duplicates, unusable locales — into clean ar/en groups whose entries
 * never expose a raw identifier as a display hint.
 */
import { curateVoices, type VoiceLike } from '../voiceCatalog';

const FIXTURE: VoiceLike[] = [
  { identifier: 'fr-1', name: 'Français', language: 'fr-FR' },
  { identifier: 'ar-ser', name: 'ar-xa-x-ser-network', language: 'ar-XA' },
  { identifier: 'en-gb-1', name: 'Google UK English', language: 'en-GB' },
  { identifier: 'ar-eg-1', name: 'Google العربية', language: 'ar_EG' },
  { identifier: 'en-us-1', name: 'en-us-x-sfg#female_1-local', language: 'en-US' },
  // Duplicate identifier — dropped.
  { identifier: 'en-us-1', name: 'Duplicate Id', language: 'en-US' },
  // Empty identifier — dropped.
  { identifier: '', name: 'No Id', language: 'en-US' },
  { identifier: '   ', name: 'Blank Id', language: 'ar-EG' },
  // name+language duplicate of ar-eg-1 under a different identifier — dropped.
  { identifier: 'ar-eg-2', name: 'Google العربية', language: 'ar-EG' },
  { identifier: 'ar-sa-1', name: 'ar-sa-x-abc-local', language: 'ar-SA' },
  // Name equals identifier — raw ID, no hint.
  { identifier: 'en-au-code', name: 'en-au-code', language: 'en-AU' },
];

describe('curateVoices', () => {
  it('keeps only ar/en, drops empty identifiers, dedupes by identifier and name+language', () => {
    const { ar, en } = curateVoices(FIXTURE);
    const allIds = [...ar, ...en].map((v) => v.identifier);
    expect(allIds).not.toContain('fr-1');
    expect(allIds).not.toContain('');
    expect(allIds.filter((id) => id === 'en-us-1')).toHaveLength(1);
    // name+language duplicate under a second identifier is gone.
    expect(allIds).not.toContain('ar-eg-2');
    expect(ar.map((v) => v.identifier)).toEqual(['ar-eg-1', 'ar-ser', 'ar-sa-1']);
  });

  it('sorts the exact preferred locale first (ar-EG / en-US), stable otherwise', () => {
    const { ar, en } = curateVoices(FIXTURE);
    expect(ar[0].identifier).toBe('ar-eg-1');
    expect(en[0].identifier).toBe('en-us-1');
    // Non-preferred locales keep their original relative order.
    expect(en.map((v) => v.identifier)).toEqual(['en-us-1', 'en-gb-1', 'en-au-code']);
  });

  it('extracts a Google hint and never surfaces raw IDs as hints', () => {
    const { ar, en } = curateVoices(FIXTURE);
    const byId = new Map([...ar, ...en].map((v) => [v.identifier, v]));
    expect(byId.get('ar-eg-1')?.engineHint).toBe('Google');
    expect(byId.get('en-gb-1')?.engineHint).toBe('Google');
    // Junk raw-ID names -> null hint.
    expect(byId.get('ar-ser')?.engineHint).toBeNull();
    expect(byId.get('en-us-1')?.engineHint).toBeNull();
    expect(byId.get('ar-sa-1')?.engineHint).toBeNull();
    // Name identical to the identifier -> null hint.
    expect(byId.get('en-au-code')?.engineHint).toBeNull();
    // No hint anywhere contains a raw voice-pack code pattern.
    for (const v of [...ar, ...en]) {
      if (v.engineHint) expect(v.engineHint).not.toContain('-x-');
    }
  });

  it('tags each entry with its language group', () => {
    const { ar, en } = curateVoices(FIXTURE);
    expect(ar.every((v) => v.lang === 'ar')).toBe(true);
    expect(en.every((v) => v.lang === 'en')).toBe(true);
  });

  it('empty input yields two empty groups', () => {
    expect(curateVoices([])).toEqual({ ar: [], en: [] });
  });

  it('language matching is case-insensitive and tolerates underscores', () => {
    const { ar, en } = curateVoices([
      { identifier: 'a1', name: 'Voice A', language: 'AR_eg' },
      { identifier: 'e1', name: 'Voice E', language: 'EN_us' },
    ]);
    expect(ar.map((v) => v.identifier)).toEqual(['a1']);
    expect(en.map((v) => v.identifier)).toEqual(['e1']);
  });
});
