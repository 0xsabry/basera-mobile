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
import { Banner, BrandLogo, ListRow, QuietGroup, Screen, SectionHeader, SegmentedControl } from '../components/ui';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { spacing } from '../theme/tokens';
import type { AppLanguage } from '../ai/types';

export default function OnboardingScreen() {
  const { settings, colors, type, update, switchLanguage } = useSettings();
  const lang = settings.language;
  const [chosen, setChosen] = useState<AppLanguage>(lang);

  const finish = async (chosenLang: AppLanguage) => {
    await update({ onboardingDone: true });
    // Language goes through switchLanguage so a direction flip gets the
    // same safe-restart treatment as a Settings change (Bug 2).
    await switchLanguage(chosenLang);
    speechService.setRate(settings.speechRate);
    if (settings.announcements) {
      // Announcement path on purpose: the welcome must NEVER become the
      // "Repeat" target (ROOT CAUSE 3).
      void speechService.speakAnnouncement(t(chosenLang, 'welcomeSpoken'), chosenLang);
    }
    router.replace('/');
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <BrandLogo height={88} />
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
          title={t(lang, 'voiceAssistance')}
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
