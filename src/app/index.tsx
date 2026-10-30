import { Redirect, router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AccessibleButton } from '../components/AccessibleButton';
import { historyStore, type HistoryItem } from '../data/HistoryStore';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { spacing, typeScale } from '../theme/tokens';

export default function HomeScreen() {
  const { settings, colors, loaded } = useSettings();
  const lang = settings.language;
  const [last, setLast] = useState<HistoryItem | null>(null);

  const refresh = useCallback(async () => {
    const items = await historyStore.list();
    setLast(items[0] ?? null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loaded && !settings.onboardingDone) {
    return <Redirect href="/onboarding" />;
  }

  const lastSummary = last
    ? last.kind === 'detection'
      ? (last.description ?? '')
      : (last.ocrText ?? '').slice(0, 160)
    : t(lang, 'noResultYet');

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
        {t(lang, 'appName')}
      </Text>
      <Text style={[styles.tagline, { color: colors.textSecondary }]}>{t(lang, 'tagline')}</Text>

      <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{t(lang, 'currentMode')}</Text>
        <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'modeReady')}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t(lang, 'hardwareStatus')}</Text>
      </View>

      <AccessibleButton label={t(lang, 'detect')} hint={t(lang, 'detectHint')} onPress={() => router.push('/detect')} />
      <AccessibleButton label={t(lang, 'readText')} hint={t(lang, 'readTextHint')} onPress={() => router.push('/read')} />
      <AccessibleButton label={t(lang, 'voice')} hint={t(lang, 'voiceHint')} onPress={() => router.push('/voice')} />
      <AccessibleButton label={t(lang, 'history')} onPress={() => router.push('/history')} variant="secondary" />
      <AccessibleButton label={t(lang, 'settings')} onPress={() => router.push('/settings')} variant="secondary" />

      <View style={[styles.statusCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>{t(lang, 'lastResult')}</Text>
        <Text style={[styles.body, { color: colors.text }]}>{lastSummary || t(lang, 'noResultYet')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  title: { fontSize: 40, fontWeight: '800', textAlign: 'center' },
  tagline: { fontSize: typeScale.body, textAlign: 'center', marginBottom: spacing.md },
  statusCard: { borderWidth: 1.5, borderRadius: 16, padding: spacing.md, gap: 6, marginVertical: spacing.sm },
  label: { fontSize: typeScale.caption, fontWeight: '700' },
  body: { fontSize: typeScale.body, lineHeight: 28 },
});
