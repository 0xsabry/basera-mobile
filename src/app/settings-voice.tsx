/**
 * Voice picker — the ONE place to choose the speech voice
 * (owner order 2026-10-31: the device voice list is long, so it no
 * longer sits inline in Settings; Settings carries a single field
 * that opens this screen).
 *
 * Three-state preference (ai/voiceCatalog VoicePreference):
 *  - 'auto' (default): Arabic speech automatically uses the device's
 *    exact ar-EG (Egyptian) voice when one is installed — Enhanced
 *    quality first — and the row's test button auditions THAT voice.
 *    When no Egyptian voice exists, the screen says so plainly, gives
 *    the Android voice-data install path, and speech keeps working
 *    with the ar-EG language fallback; no Saudi/other Arabic voice is
 *    ever silently labelled Egyptian.
 *  - 'system': an EXPLICIT choice of the OS default voice, persisted
 *    as its own state so it is never mistaken for "never chose".
 *  - 'custom': one specific voice from the curated AR/EN catalog.
 * Raw Android voice identifiers are never displayed.
 * Also here: the stale-voice guard (a custom identifier the device no
 * longer offers resets to 'auto'), per-voice test buttons, and the
 * failed-test fallback of a selected custom voice to 'auto'.
 */
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { curateVoices, selectEgyptianVoice, type CuratedVoices, type VoiceLike } from '../ai/voiceCatalog';
import { AccessibleButton } from '../components/AccessibleButton';
import { ListRow, QuietGroup, Screen, SectionHeader } from '../components/ui';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { spacing } from '../theme/tokens';

export default function SettingsVoiceScreen() {
  const { settings, colors, type, update } = useSettings();
  const lang = settings.language;
  const pref = settings.voicePreference;
  const [voiceCatalog, setVoiceCatalog] = useState<CuratedVoices | null>(null);
  const [rawVoices, setRawVoices] = useState<VoiceLike[] | null>(null);
  const [voiceTestFailed, setVoiceTestFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await Speech.getAvailableVoicesAsync();
      setRawVoices(all);
      setVoiceCatalog(curateVoices(all));
      // Share the fresh catalog with the speech service so 'auto'
      // resolution uses the same list (no second discovery).
      speechService.noteAvailableVoices(all);
      // Stale-voice guard (Bug 4): a persisted CUSTOM identifier the
      // device no longer offers can silence EVERY utterance. If the
      // service's selection is not in the fresh device list, reset it
      // (service + persisted settings) to the 'auto' preference.
      const availableIds = new Set(all.map((v) => v.identifier));
      if (!speechService.validateVoiceSelection(availableIds)) {
        void update({ voicePreference: { kind: 'auto' } });
      }
    } catch {
      // Listing itself failed: both language groups render the
      // no-voice guidance instead of the picker silently disappearing.
      setRawVoices([]);
      setVoiceCatalog({ ar: [], en: [] });
    }
  }, [update]);

  useEffect(() => {
    void load();
  }, [load]);

  const onTestVoice = async (identifier: string | null, testLang: 'ar' | 'en') => {
    setVoiceTestFailed(false);
    const ok = await speechService.testSpeak(identifier, testLang);
    if (ok) return;
    setVoiceTestFailed(true);
    // The failed voice was the SELECTED custom one: per the
    // voiceTestFailed copy, fall back to the automatic preference
    // instead of leaving a voice that cannot speak in place. (A failed
    // audition of a non-selected voice — including the auto/system
    // rows — changes no preference.)
    if (identifier !== null && pref.kind === 'custom' && pref.identifier === identifier) {
      speechService.setVoicePreference({ kind: 'auto' });
      void update({ voicePreference: { kind: 'auto' } });
    }
  };

  const egyptian = rawVoices ? selectEgyptianVoice(rawVoices) : null;
  const checkMark = (
    <Text style={{ color: colors.primary, fontSize: type.body, fontWeight: '800' }}>{GLYPHS.check}</Text>
  );

  return (
    <Screen>
      <SectionHeader title={t(lang, 'voicePickerTitle')} glyph={GLYPHS.voice} />
      <QuietGroup>
        {voiceCatalog !== null && (
          <View style={styles.fieldBlock}>
            <ListRow
              variant="quiet"
              title={t(lang, 'voiceAutoEgyptian')}
              subtitle={t(lang, 'voiceAutoExpl')}
              accessibilityLabel={t(lang, 'voiceAutoEgyptian')}
              onPress={() => void update({ voicePreference: { kind: 'auto' } })}
              right={pref.kind === 'auto' ? checkMark : undefined}
            />
            <AccessibleButton
              label={t(lang, 'voiceTest')}
              variant="secondary"
              glyph={GLYPHS.speak}
              onPress={() => void onTestVoice(lang === 'ar' ? (egyptian?.identifier ?? null) : null, lang)}
            />
            <ListRow
              variant="quiet"
              title={t(lang, 'voiceDefault')}
              accessibilityLabel={t(lang, 'voiceDefault')}
              onPress={() => void update({ voicePreference: { kind: 'system' } })}
              right={pref.kind === 'system' ? checkMark : undefined}
            />
            <AccessibleButton
              label={t(lang, 'voiceTest')}
              variant="secondary"
              glyph={GLYPHS.speak}
              onPress={() => void onTestVoice(null, lang)}
            />
            {(['ar', 'en'] as const).map((groupLang) => {
              const group = voiceCatalog[groupLang];
              const groupTitle = t(lang, groupLang === 'ar' ? 'voiceAvailableAr' : 'voiceAvailableEn');
              return (
                <View key={groupLang} style={styles.fieldBlock}>
                  <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
                    {groupTitle}
                  </Text>
                  {groupLang === 'ar' && rawVoices !== null && egyptian === null && (
                    <View style={styles.fieldBlock}>
                      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
                        {t(lang, 'voiceEgyptianUnavailable')}
                      </Text>
                      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
                        {t(lang, 'voiceInstallGuidance')}
                      </Text>
                    </View>
                  )}
                  {group.length === 0 ? (
                    <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
                      {t(lang, 'voiceNoneAvailable')}
                    </Text>
                  ) : (
                    group.map((v) => {
                      const label = v.engineHint ? `${groupTitle} · ${v.engineHint}` : groupTitle;
                      const selected = pref.kind === 'custom' && pref.identifier === v.identifier;
                      return (
                        <View key={v.identifier} style={styles.fieldBlock}>
                          <ListRow
                            variant="quiet"
                            title={label}
                            accessibilityLabel={label}
                            onPress={() => void update({ voicePreference: { kind: 'custom', identifier: v.identifier } })}
                            right={selected ? checkMark : undefined}
                          />
                          <AccessibleButton
                            label={t(lang, 'voiceTest')}
                            variant="secondary"
                            glyph={GLYPHS.speak}
                            onPress={() => void onTestVoice(v.identifier, groupLang)}
                          />
                        </View>
                      );
                    })
                  )}
                </View>
              );
            })}
            {!!voiceTestFailed && (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.body, { color: colors.danger, fontSize: type.body }]}
              >
                {t(lang, 'voiceTestFailed')}
              </Text>
            )}
          </View>
        )}
      </QuietGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
  label: { fontWeight: '600' },
  fieldBlock: { gap: spacing.sm },
});
