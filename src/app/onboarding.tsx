/**
 * Onboarding — one honest step: what BASERA does, the plain truth
 * about the glasses (still in development; the phone is the input
 * today), and the language choice that finishes setup.
 *
 * V1.1 redesign: brand hero, the short body copy as quiet text, one
 * quiet feature row per core capability (detect / read / voice), the
 * glasses honesty note as a slim banner, a segmented language choice,
 * and Start as the single filled primary action. The finish flow —
 * including the announcement-only welcome that must never become the
 * Repeat target — is unchanged.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { Banner, BrandMark, ListRow, QuietGroup, Screen, SectionHeader, SegmentedControl } from '../components/ui';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { spacing } from '../theme/tokens';
import type { AppLanguage } from '../ai/types';

export default function OnboardingScreen() {
  const { settings, colors, type, update } = useSettings();
  const lang = settings.language;
  const [chosen, setChosen] = useState<AppLanguage>(lang);

  const finish = async (chosenLang: AppLanguage) => {
    await update({ language: chosenLang, onboardingDone: true });
    speechService.setRate(settings.speechRate);
    if (settings.announcements) {
      // Announcement path on purpose: the welcome must NEVER become the
      // "Repeat" target (ROOT CAUSE 3).
      void speechService.speakAnnouncement(
        chosenLang === 'ar' ? 'أهلاً بك في بصيرة. اختار اللي تحب تعمله من الشاشة الرئيسية.' : 'Welcome to BASERA. Choose what you would like to do from the home screen.',
        chosenLang,
      );
    }
    router.replace('/');
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <BrandMark size={84} />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontSize: type.display + 10 }]}>
          {t(lang, 'appName')}
        </Text>
        <Text style={[styles.tagline, { color: colors.textSecondary, fontSize: type.bodyLarge }]}>
          {t(lang, 'tagline')}
        </Text>
        <Text style={[styles.welcome, { color: colors.text, fontSize: type.bodyLarge }]}>
          {t(lang, 'onboardingWelcome')}
        </Text>
      </View>

      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'onboardingBody')}</Text>

      <QuietGroup>
        <ListRow
          variant="quiet"
          glyph={GLYPHS.detect}
          title={t(lang, 'detect')}
          subtitle={t(lang, 'identifyObjectsHint')}
        />
        <ListRow
          variant="quiet"
          glyph={GLYPHS.read}
          title={t(lang, 'readText')}
          subtitle={t(lang, 'readTextHint')}
        />
        <ListRow
          variant="quiet"
          glyph={GLYPHS.voice}
          title={t(lang, 'voice')}
          subtitle={t(lang, 'voiceHint')}
        />
      </QuietGroup>

      <Banner tone="info" glyph={GLYPHS.glasses} title={t(lang, 'glassesCardTitle')}>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {t(lang, 'onboardingGlassesNote')}
        </Text>
      </Banner>

      <SectionHeader title={t(lang, 'onboardingPickLanguage')} glyph={GLYPHS.language} />
      <SegmentedControl
        accessibilityLabel={t(lang, 'onboardingPickLanguage')}
        value={chosen}
        onChange={setChosen}
        options={[
          { value: 'ar' as const, label: 'العربية' },
          { value: 'en' as const, label: 'English' },
        ]}
      />
      <AccessibleButton label={t(lang, 'start')} glyph={GLYPHS.check} onPress={() => void finish(chosen)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  title: { fontWeight: '800', textAlign: 'center' },
  tagline: { textAlign: 'center', lineHeight: 30 },
  welcome: { textAlign: 'center', lineHeight: 32, fontWeight: '600', marginTop: spacing.sm },
  body: { lineHeight: 30 },
});
