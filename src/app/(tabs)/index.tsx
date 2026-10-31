/**
 * Home — the command center, rebuilt on the V1.1 design system.
 *
 * Structure: brand header (greeting + today's date), one hero voice
 * action, an honest smart-glasses status card (not connected — the
 * phone camera is the active input), a device status card built from
 * REAL signals (assistant readiness + the real family sharing state),
 * a two-column feature grid with distinct glyphs/subtitles, then the
 * contextual cards (latest unacknowledged high alert, last result
 * with Repeat). Nothing here fakes a status: the service note appears
 * ONLY when the guardian service is actually unconfigured.
 */
import { Redirect, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { AccessibleButton } from '../../components/AccessibleButton';
import {
  AppHeader,
  Banner,
  Card,
  CompactAction,
  FeatureGrid,
  FeatureTile,
  HeroAction,
  IconTile,
  Screen,
  SectionHeader,
  StatusPill,
} from '../../components/ui';
import { historyStore, type HistoryItem } from '../../data/HistoryStore';
import { getGuardianService } from '../../guardian/GuardianService';
import { alertHistoryStore, type AlertEvent } from '../../hazards/AlertHistoryStore';
import { t } from '../../i18n/strings';
import { announceNearbyPlaces } from '../../places/proximity';
import { pushOnce } from '../../state/navGuard';
import { useSettings } from '../../state/SettingsContext';
import { GLYPHS } from '../../theme/glyphs';
import { spacing } from '../../theme/tokens';

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
  const sharingTone = !guardianConfigured ? 'warning' : settings.guardianSharingEnabled ? 'success' : 'neutral';

  const repeatLastResult = () => {
    if (!last) return;
    const text = last.kind === 'detection' ? last.description : last.ocrText;
    if (text) {
      speechService.setRate(settings.speechRate);
      void speechService.speak(text, lang);
    }
  };

  const dateLine = new Date().toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <Screen>
      <AppHeader
        brandName={t(lang, 'appName')}
        tagline={t(lang, 'tagline')}
        greeting={t(lang, 'homeGreeting')}
        dateLine={dateLine}
      />

      <HeroAction
        label={t(lang, 'startVoiceAssistant')}
        hint={t(lang, 'voiceHint')}
        stateLabel={t(lang, 'voiceHeroState')}
        glyph={GLYPHS.voice}
        onPress={() => pushOnce('/voice')}
      />

      {/* Smart glasses — honest NotAvailable state, never faked. */}
      <Card accessibilityLabel={`${t(lang, 'glassesCardTitle')}. ${t(lang, 'glassesCardStatus')}. ${t(lang, 'glassesCardBody')}`}>
        <View style={styles.statusRow}>
          <IconTile glyph={GLYPHS.glasses} tone="neutral" />
          <View style={styles.flexText}>
            <Text style={[styles.cardTitle, { color: colors.text, fontSize: type.bodyLarge }]}>
              {t(lang, 'glassesCardTitle')}
            </Text>
            <StatusPill tone="neutral" glyph={GLYPHS.glasses} label={t(lang, 'glassesCardStatus')} />
          </View>
        </View>
        <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
          {t(lang, 'glassesCardBody')}
        </Text>
      </Card>

      {/* Device status — real signals only. */}
      <Card>
        <SectionHeader title={t(lang, 'deviceStatusTitle')} glyph={GLYPHS.detect} />
        <View style={styles.statusRow}>
          <Text style={[styles.body, styles.flexText, { color: colors.text, fontSize: type.body }]}>
            {t(lang, 'assistantStatus')}
          </Text>
          <StatusPill tone="success" label={`${t(lang, 'statusReady')} — ${t(lang, 'modeReady')}`} />
        </View>
        <View style={styles.statusRow}>
          <Text style={[styles.body, styles.flexText, { color: colors.text, fontSize: type.body }]}>
            {t(lang, 'familySafety')}
          </Text>
          <StatusPill tone={sharingTone} label={sharingText} />
        </View>
        <CompactAction
          label={t(lang, 'family')}
          glyph={GLYPHS.family}
          onPress={() => pushOnce('/family')}
        />
      </Card>

      <SectionHeader title={t(lang, 'exploreTitle')} glyph={GLYPHS.assistance} />
      <FeatureGrid>
        <FeatureTile
          layout="grid"
          glyph={GLYPHS.detect}
          title={t(lang, 'detect')}
          subtitle={t(lang, 'identifyObjectsHint')}
          hint={t(lang, 'detectHint')}
          onPress={() => pushOnce('/detect')}
        />
        <FeatureTile
          layout="grid"
          glyph={GLYPHS.read}
          tone="info"
          title={t(lang, 'readText')}
          subtitle={t(lang, 'readTextHint')}
          hint={t(lang, 'readTextHint')}
          onPress={() => pushOnce('/read')}
        />
        <FeatureTile
          layout="grid"
          glyph={GLYPHS.voice}
          title={t(lang, 'voice')}
          subtitle={t(lang, 'voiceHint')}
          hint={t(lang, 'voiceHint')}
          onPress={() => pushOnce('/voice')}
        />
        <FeatureTile
          layout="grid"
          glyph={GLYPHS.places}
          tone="info"
          title={t(lang, 'places')}
          subtitle={t(lang, 'placesHint')}
          hint={t(lang, 'placesHint')}
          onPress={() => pushOnce('/places')}
        />
        <FeatureTile
          layout="grid"
          glyph={GLYPHS.alerts}
          tone="warning"
          title={t(lang, 'viewAlerts')}
          subtitle={t(lang, 'alertsSubtitle')}
          onPress={() => pushOnce('/alerts')}
        />
        <FeatureTile
          layout="grid"
          glyph={GLYPHS.family}
          tone="success"
          title={t(lang, 'family')}
          subtitle={t(lang, 'familySubtitle')}
          hint={t(lang, 'guardianHint')}
          onPress={() => pushOnce('/family')}
        />
      </FeatureGrid>

      {activeAlert && (
        <Banner tone="danger" glyph={GLYPHS.alerts} title={t(lang, 'alertsLatest')}>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {activeAlert.kind === 'sos' ? t(lang, 'sosTitle') : activeAlert.className} —{' '}
            {new Date(activeAlert.timestamp).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}
          </Text>
          <AccessibleButton label={t(lang, 'viewAlerts')} onPress={() => pushOnce('/alerts')} variant="secondary" />
        </Banner>
      )}

      <Card>
        <SectionHeader title={t(lang, 'lastResult')} glyph={GLYPHS.history} />
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {lastSummary || t(lang, 'noResultYet')}
        </Text>
        {last && (
          <AccessibleButton label={t(lang, 'repeat')} glyph={GLYPHS.repeat} onPress={repeatLastResult} variant="secondary" />
        )}
      </Card>

      {!guardianConfigured && (
        <Banner tone="warning" title={t(lang, 'serviceNoteTitle')}>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {t(lang, 'guardianNotConfigured')}
          </Text>
        </Banner>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flexText: { flex: 1, gap: spacing.xs },
  cardTitle: { fontWeight: '800', lineHeight: 28 },
  body: { lineHeight: 29 },
});
