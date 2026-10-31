/**
 * Home — the command center, v1.1.4 recomposition
 * (docs/IDENTITY_OLIVE_1.1.4.md).
 *
 * The owner's defect list for the old Home: excessive vertical
 * stacking, oversized repetitive cards, unbalanced spacing, weak
 * hierarchy, too much text inside cards. The recomposition keeps
 * every destination and every datum the old screen showed, in a
 * compact order: (1) compact brand header (logo + name/tagline,
 * one-line greeting, date), (2) the «المساعد الذكي» hero, (3) the
 * four core features as a 2×2 grid with ONE-line subtitles, (4) the
 * SOS safety strip (danger treatment; same trigger flow as the
 * Assistance/Alerts SOS buttons), (5) the glasses status as a
 * compact chip row, (6) ONE combined «الموقع والأماكن» section —
 * the family/guardian strip (real sharing state) as its status
 * line, then the last result with Repeat — and the active-alert
 * banner when one is present. TalkBack order = visual order;
 * every target ≥ 48dp.
 */
import { Redirect, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { AccessibleButton } from '../../components/AccessibleButton';
import {
  AppHeader,
  Banner,
  FeatureGrid,
  FeatureTile,
  HeroAction,
  Screen,
  SectionHeader,
  SosStrip,
  StatusStrip,
} from '../../components/ui';
import { historyStore, type HistoryItem } from '../../data/HistoryStore';
import { getGuardianService } from '../../guardian/GuardianService';
import { alertHistoryStore, type AlertEvent } from '../../hazards/AlertHistoryStore';
import { triggerSos } from '../../hazards/HazardService';
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
  const [sosMessage, setSosMessage] = useState('');

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

  // Same SOS flow as Assistance/Alerts: triggerSos records the
  // event, notifies guardians when SOS sharing is on, and speaks
  // the honest outcome; the strip also surfaces it as live text.
  const onSos = async () => {
    const outcome = await triggerSos(lang);
    setSosMessage(outcome.message);
    if (settings.announcements) {
      void speechService.speakAnnouncement(outcome.message, lang);
    }
  };

  const dateLine = new Date().toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <Screen style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm }}>
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

      {/* Core features — a balanced 2×2 grid, one-line subtitles. */}
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
          title={t(lang, 'readText')}
          subtitle={t(lang, 'readTextHint')}
          hint={t(lang, 'readTextHint')}
          onPress={() => pushOnce('/read')}
        />
        <FeatureTile
          layout="grid"
          glyph={GLYPHS.places}
          title={t(lang, 'places')}
          subtitle={t(lang, 'placesHint')}
          hint={t(lang, 'placesHint')}
          onPress={() => pushOnce('/places')}
        />
        <FeatureTile
          layout="grid"
          glyph={GLYPHS.alerts}
          title={t(lang, 'viewAlerts')}
          subtitle={t(lang, 'alertsSubtitle')}
          hint={t(lang, 'alertsSubtitle')}
          onPress={() => pushOnce('/alerts')}
        />
      </FeatureGrid>

      {/* SOS — one distinguished full-width safety strip. */}
      <SosStrip
        glyph={GLYPHS.sos}
        title={t(lang, 'sosTitle')}
        actionLabel={t(lang, 'sosButton')}
        message={sosMessage}
        onPress={() => void onSos()}
      />

      {/* Smart glasses — honest NotAvailable state, one compact row. */}
      <StatusStrip
        compact
        glyph={GLYPHS.glasses}
        title={t(lang, 'glassesCardTitle')}
        pillLabel={t(lang, 'glassesCardStatus')}
        pillTone="neutral"
        pillGlyph={GLYPHS.glasses}
      />

      {/* Location & places — ONE combined section: the family strip
          carries the real location-sharing state as its status
          line; the last result (with Repeat) closes the section. */}
      <SectionHeader title={t(lang, 'locationAndPlaces')} glyph={GLYPHS.location} />
      <StatusStrip
        compact
        glyph={GLYPHS.family}
        glyphTone="primary"
        title={t(lang, 'familySafety')}
        pillLabel={sharingText}
        pillTone={sharingTone}
        onPress={() => pushOnce('/family')}
      />

      {activeAlert && (
        <Banner tone="danger" glyph={GLYPHS.alerts} title={t(lang, 'alertsLatest')}>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {activeAlert.kind === 'sos' ? t(lang, 'sosTitle') : activeAlert.className} —{' '}
            {new Date(activeAlert.timestamp).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}
          </Text>
          <AccessibleButton label={t(lang, 'viewAlerts')} onPress={() => pushOnce('/alerts')} variant="secondary" />
        </Banner>
      )}

      <View style={styles.lastResult}>
        <Text style={{ color: colors.textSecondary, fontSize: type.caption, fontWeight: '700' }}>
          {t(lang, 'lastResult')}
        </Text>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {lastSummary || t(lang, 'noResultYet')}
        </Text>
        {last ? (
          <AccessibleButton label={t(lang, 'repeat')} glyph={GLYPHS.repeat} onPress={repeatLastResult} variant="secondary" />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
  lastResult: { gap: spacing.xs },
});
