/**
 * Home — the command center. One prominent voice button, four large
 * actions, the last useful result (repeatable), and honest status:
 * family sharing state comes from the real settings + service
 * configuration; the service note appears ONLY when a service is
 * actually unavailable. Nothing here fakes a status.
 */
import { Redirect, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { AccessibleButton } from '../../components/AccessibleButton';
import { historyStore, type HistoryItem } from '../../data/HistoryStore';
import { getGuardianService } from '../../guardian/GuardianService';
import { alertHistoryStore, type AlertEvent } from '../../hazards/AlertHistoryStore';
import { t } from '../../i18n/strings';
import { announceNearbyPlaces } from '../../places/proximity';
import { pushOnce } from '../../state/navGuard';
import { useSettings } from '../../state/SettingsContext';
import { radius, spacing } from '../../theme/tokens';

export default function HomeScreen() {
  const { settings, colors, type, loaded } = useSettings();
  const lang = settings.language;
  const [last, setLast] = useState<HistoryItem | null>(null);
  const [activeAlert, setActiveAlert] = useState<AlertEvent | null>(null);

  const refresh = useCallback(async () => {
    const items = await historyStore.list();
    setLast(items[0] ?? null);
    setActiveAlert(await alertHistoryStore.latestUnacknowledgedHigh());
  }, []);

  // Tab screens stay mounted — refresh on every focus so "last result"
  // and the family state are never stale.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      // Foreground proximity awareness: speaks only when a fix is
      // already permitted and a place is newly within radius.
      void announceNearbyPlaces(lang, settings.proximityRadiusM);
    }, [refresh, lang, settings.proximityRadiusM]),
  );

  if (loaded && !settings.onboardingDone) {
    return <Redirect href="/onboarding" />;
  }

  const lastSummary = last
    ? last.kind === 'detection'
      ? (last.description ?? '')
      : (last.ocrText ?? '').slice(0, 160)
    : t(lang, 'noResultYet');

  const guardianConfigured = getGuardianService().isConfigured();
  const sharingText = !guardianConfigured
    ? t(lang, 'sharingStateUnconfigured')
    : settings.guardianSharingEnabled
      ? t(lang, 'sharingStateOn')
      : t(lang, 'sharingStateOff');

  const repeatLastResult = () => {
    if (!last) return;
    const text = last.kind === 'detection' ? last.description : last.ocrText;
    if (text) {
      speechService.setRate(settings.speechRate);
      void speechService.speak(text, lang);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text, fontSize: type.title + 8 }]}>
        {t(lang, 'appName')}
      </Text>
      <Text style={[styles.tagline, { color: colors.textSecondary, fontSize: type.body }]}>
        {t(lang, 'tagline')}
      </Text>
      <Text style={[styles.greeting, { color: colors.text, fontSize: type.heading }]}>
        {t(lang, 'homeGreeting')}
      </Text>

      <AccessibleButton
        label={t(lang, 'startVoiceAssistant')}
        hint={t(lang, 'voiceHint')}
        onPress={() => pushOnce('/voice')}
      />

      <AccessibleButton
        label={t(lang, 'detect')}
        hint={t(lang, 'detectHint')}
        onPress={() => pushOnce('/detect')}
        variant="secondary"
      />
      <AccessibleButton
        label={t(lang, 'readText')}
        hint={t(lang, 'readTextHint')}
        onPress={() => pushOnce('/read')}
        variant="secondary"
      />
      <AccessibleButton
        label={t(lang, 'identifyObjects')}
        hint={t(lang, 'identifyObjectsHint')}
        onPress={() => pushOnce('/detect')}
        variant="secondary"
      />
      <AccessibleButton
        label={t(lang, 'places')}
        hint={t(lang, 'placesHint')}
        onPress={() => pushOnce('/places')}
        variant="secondary"
      />

      {activeAlert && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.danger, borderWidth: 3 }]}>
          <Text style={[styles.label, { color: colors.danger, fontSize: type.caption }]}>
            {t(lang, 'alertsLatest')}
          </Text>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {activeAlert.kind === 'sos' ? t(lang, 'sosTitle') : activeAlert.className} —{' '}
            {new Date(activeAlert.timestamp).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}
          </Text>
          <AccessibleButton label={t(lang, 'viewAlerts')} onPress={() => pushOnce('/alerts')} variant="secondary" />
        </View>
      )}

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
          {t(lang, 'assistantStatus')}
        </Text>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {t(lang, 'statusReady')} — {t(lang, 'modeReady')}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
          {t(lang, 'hardwareStatus')}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
          {t(lang, 'lastResult')}
        </Text>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {lastSummary || t(lang, 'noResultYet')}
        </Text>
        {last && (
          <AccessibleButton label={t(lang, 'repeat')} onPress={repeatLastResult} variant="secondary" />
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
          {t(lang, 'familySafety')}
        </Text>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{sharingText}</Text>
        <AccessibleButton
          label={t(lang, 'family')}
          hint={t(lang, 'guardianHint')}
          onPress={() => pushOnce('/family')}
          variant="secondary"
        />
      </View>

      {!guardianConfigured && (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.warning }]}>
          <Text style={[styles.label, { color: colors.warning, fontSize: type.caption }]}>
            {t(lang, 'serviceNoteTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {t(lang, 'guardianNotConfigured')}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  title: { fontWeight: '800', textAlign: 'center' },
  tagline: { textAlign: 'center' },
  greeting: { fontWeight: '700', textAlign: 'center', marginVertical: spacing.sm },
  card: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, gap: 6, marginVertical: spacing.sm },
  label: { fontWeight: '700' },
  body: { lineHeight: 29 },
});
