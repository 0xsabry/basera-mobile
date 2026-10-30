import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { spacing, typeScale } from '../theme/tokens';
import type { AppLanguage } from '../ai/types';

export default function OnboardingScreen() {
  const { settings, colors, update } = useSettings();
  const lang = settings.language;

  const finish = async (chosen: AppLanguage) => {
    await update({ language: chosen, onboardingDone: true });
    speechService.setRate(settings.speechRate);
    if (settings.announcements) {
      void speechService.speak(
        chosen === 'ar' ? 'أهلاً بك في بصيرة. اختار اللي تحب تعمله من الشاشة الرئيسية.' : 'Welcome to BASERA. Choose what you would like to do from the home screen.',
        chosen,
      );
    }
    router.replace('/');
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {t(lang, 'appName')}
      </Text>
      <Text style={[styles.tagline, { color: colors.textSecondary }]}>{t(lang, 'tagline')}</Text>
      <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'onboardingBody')}</Text>
      <View style={[styles.note, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'onboardingGlassesNote')}</Text>
      </View>
      <Text style={[styles.heading, { color: colors.text }]}>{t(lang, 'onboardingPickLanguage')}</Text>
      <AccessibleButton label="العربية" hint="اختيار العربية كلغة التطبيق" onPress={() => finish('ar')} />
      <AccessibleButton label="English" hint="Choose English as the app language" onPress={() => finish('en')} variant="secondary" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 44, fontWeight: '800', textAlign: 'center' },
  tagline: { fontSize: typeScale.bodyLarge, textAlign: 'center' },
  body: { fontSize: typeScale.body, lineHeight: 30 },
  heading: { fontSize: typeScale.heading, fontWeight: '700', marginTop: spacing.md },
  note: { borderWidth: 1.5, borderRadius: 16, padding: spacing.md },
});
