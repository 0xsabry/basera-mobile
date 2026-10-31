/**
 * Voice picker — the ONE place to choose the speech voice
 * (owner order 2026-10-31: the device voice list is long, so it no
 * longer sits inline in Settings; Settings carries a single field
 * that opens this screen). Everything here is the picker that used
 * to render inside Settings section C, moved unchanged: the device
 * catalog (expo-speech getAvailableVoicesAsync, curated AR/EN), the
 * stale-voice guard, the system-default option, per-voice test
 * buttons, and the failed-test fallback to the system default.
 * Speech engine, rates and the stored preference shape are untouched.
 */
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { curateVoices, type CuratedVoices } from '../ai/voiceCatalog';
import { AccessibleButton } from '../components/AccessibleButton';
import { ListRow, QuietGroup, Screen, SectionHeader } from '../components/ui';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { spacing } from '../theme/tokens';

export default function SettingsVoiceScreen() {
  const { settings, colors, type, update } = useSettings();
  const lang = settings.language;
  const [voiceCatalog, setVoiceCatalog] = useState<CuratedVoices | null>(null);
  const [voiceTestFailed, setVoiceTestFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const all = await Speech.getAvailableVoicesAsync();
      setVoiceCatalog(curateVoices(all));
      // Stale-voice guard (Bug 4): a persisted voice identifier the
      // device no longer offers can silence EVERY utterance. If the
      // service's selection is not in the fresh device list, clear it
      // (service + persisted settings) back to the system default.
      const availableIds = new Set(all.map((v) => v.identifier));
      if (!speechService.validateVoiceSelection(availableIds)) {
        void update({ voiceIdentifier: null });
      }
    } catch {
      // Listing itself failed: both language groups render the
      // no-voice guidance instead of the picker silently disappearing.
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
    // The failed voice was the SELECTED one: per the voiceTestFailed
    // copy, fall back to the system default instead of leaving a
    // voice that cannot speak in place.
    const failedWasSelected =
      identifier === null ? settings.voiceIdentifier === null : settings.voiceIdentifier === identifier;
    if (failedWasSelected && settings.voiceIdentifier !== null) {
      speechService.setVoiceIdentifier(null);
      void update({ voiceIdentifier: null });
    }
  };

  return (
    <Screen>
      <SectionHeader title={t(lang, 'voicePickerTitle')} glyph={GLYPHS.voice} />
      <QuietGroup>
        {voiceCatalog !== null && (
          <View style={styles.fieldBlock}>
            <ListRow
              variant="quiet"
              title={t(lang, 'voiceDefault')}
              accessibilityLabel={t(lang, 'voiceDefault')}
              onPress={() => void update({ voiceIdentifier: null })}
              right={
                settings.voiceIdentifier === null ? (
                  <Text style={{ color: colors.primary, fontSize: type.body, fontWeight: '800' }}>{GLYPHS.check}</Text>
                ) : undefined
              }
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
                  {group.length === 0 ? (
                    <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
                      {t(lang, 'voiceNoneAvailable')}
                    </Text>
                  ) : (
                    group.map((v) => {
                      const label = v.engineHint ? `${groupTitle} · ${v.engineHint}` : groupTitle;
                      const selected = settings.voiceIdentifier === v.identifier;
                      return (
                        <View key={v.identifier} style={styles.fieldBlock}>
                          <ListRow
                            variant="quiet"
                            title={label}
                            accessibilityLabel={label}
                            onPress={() => void update({ voiceIdentifier: v.identifier })}
                            right={
                              selected ? (
                                <Text style={{ color: colors.primary, fontSize: type.body, fontWeight: '800' }}>
                                  {GLYPHS.check}
                                </Text>
                              ) : undefined
                            }
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
