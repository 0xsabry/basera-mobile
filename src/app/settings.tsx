import Slider from '@react-native-community/slider';
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { historyStore } from '../data/HistoryStore';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { MIN_TOUCH, spacing, typeScale } from '../theme/tokens';

export default function SettingsScreen() {
  const { settings, colors, update } = useSettings();
  const lang = settings.language;

  const row = (label: string, control: React.ReactNode, hint?: string) => (
    <View
      style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
      accessible
      accessibilityLabel={label}
      accessibilityHint={hint}
    >
      <Text style={[styles.body, { color: colors.text, flex: 1 }]}>{label}</Text>
      {control}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t(lang, 'language')}
      </Text>
      <AccessibleButton
        label="العربية"
        onPress={() => update({ language: 'ar' })}
        variant={lang === 'ar' ? 'primary' : 'secondary'}
      />
      <AccessibleButton
        label="English"
        onPress={() => update({ language: 'en' })}
        variant={lang === 'en' ? 'primary' : 'secondary'}
      />

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t(lang, 'theme')}
      </Text>
      <AccessibleButton label={t(lang, 'themeLight')} onPress={() => update({ theme: 'light' })} variant={settings.theme === 'light' ? 'primary' : 'secondary'} />
      <AccessibleButton label={t(lang, 'themeDark')} onPress={() => update({ theme: 'dark' })} variant={settings.theme === 'dark' ? 'primary' : 'secondary'} />
      <AccessibleButton label={t(lang, 'themeSystem')} onPress={() => update({ theme: 'system' })} variant={settings.theme === 'system' ? 'primary' : 'secondary'} />

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t(lang, 'speechRate')}: {settings.speechRate.toFixed(2)}x
      </Text>
      <Slider
        accessibilityLabel={t(lang, 'speechRate')}
        minimumValue={0.5}
        maximumValue={2}
        step={0.25}
        value={settings.speechRate}
        minimumTrackTintColor={colors.primary}
        thumbTintColor={colors.primary}
        style={{ minHeight: MIN_TOUCH }}
        onValueChange={(v) => {
          speechService.setRate(v);
          void update({ speechRate: v });
        }}
      />

      {row(
        t(lang, 'highContrast'),
        <Switch
          accessibilityLabel={t(lang, 'highContrast')}
          value={settings.highContrast}
          onValueChange={(v) => update({ highContrast: v })}
          trackColor={{ true: colors.primary }}
        />,
      )}
      {row(
        t(lang, 'announcements'),
        <Switch
          accessibilityLabel={t(lang, 'announcements')}
          value={settings.announcements}
          onValueChange={(v) => update({ announcements: v })}
          trackColor={{ true: colors.primary }}
        />,
      )}

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t(lang, 'guardian')}
      </Text>
      <AccessibleButton label={t(lang, 'guardian')} hint={t(lang, 'guardianHint')} onPress={() => router.push('/guardian')} variant="secondary" />
      <AccessibleButton label={t(lang, 'updates')} hint={t(lang, 'updatesHint')} onPress={() => router.push('/updates')} variant="secondary" />

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t(lang, 'privacy')}
      </Text>
      <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'privacyBody')}</Text>
      <AccessibleButton
        label={t(lang, 'clearAll')}
        variant="danger"
        onPress={async () => {
          await historyStore.clear();
        }}
      />

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t(lang, 'about')}
      </Text>
      <Text style={[styles.body, { color: colors.text }]}>BASERA 1.1.0 — me.auramarketing.basera</Text>
      <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'hardwareStatus')}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{t(lang, 'onboardingGlassesNote')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  heading: { fontSize: typeScale.heading, fontWeight: '700', marginTop: spacing.md },
  body: { fontSize: typeScale.body, lineHeight: 29 },
  row: {
    borderWidth: 1.5,
    borderRadius: 14,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH,
    gap: spacing.sm,
  },
});
