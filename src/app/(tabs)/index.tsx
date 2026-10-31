/**
 * Home — the command center, polish pass (docs/POLISH.md).
 *
 * Exact structure, nothing else: (1) compact brand header, (2) the
 * greeting as page title, (3) one refined voice activation control
 * (typography-led, small mic icon), (4) the four core features,
 * (5) the compact glasses status strip («النظارة غير متصلة»), (6) the
 * family strip carrying the REAL sharing state, (7) the active-alert
 * banner and the last result with Repeat, when present. No slogans,
 * no paragraphs, no badges; whitespace does the work.
 *
 * v1.1.2 recomposition: step (4) is now a balanced 2×2 GRID of
 * compact feature tiles instead of four full-width list rows — the
 * stacked oversized-row list was the owner's core complaint. Same
 * four destinations, same order (TalkBack order = visual order),
 * same labels/hints; tiles keep ≥48dp targets and 24dp glyphs.
 */
import { Redirect, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { AccessibleButton } from '../../components/AccessibleButton';
import {
  AppHeader,
  Banner,
  FeatureGrid,
  FeatureTile,
  HeroAction,
  QuietGroup,
  Screen,
  SectionHeader,
  StatusStrip,
} from '../../components/ui';
import { historyStore, type HistoryItem } from '../../data/HistoryStore';
import { getGuardianService } from '../../guardian/GuardianService';
import { alertHistoryStore, type AlertEvent } from '../../hazards/AlertHistoryStore';
import { t } from '../../i18n/strings';
import { announceNearbyPlaces } from '../../places/proximity';
import { pushOnce } from '../../state/navGuard';
import { useSettings } from '../../state/SettingsContext';
import { GLYPHS } from '../../theme/glyphs';

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

      {/* Core features — a balanced 2×2 grid of compact tiles. */}
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
          onPress={() => pushOnce('/alerts')}
        />
      </FeatureGrid>

      {/* Smart glasses — honest NotAvailable state, one compact line. */}
      <StatusStrip
        glyph={GLYPHS.glasses}
        title={t(lang, 'glassesCardTitle')}
        pillLabel={t(lang, 'glassesCardStatus')}
        pillTone="neutral"
        pillGlyph={GLYPHS.glasses}
      />

      {/* Family safety — the REAL sharing state, one tappable row. */}
      <StatusStrip
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

      <SectionHeader title={t(lang, 'lastResult')} glyph={GLYPHS.history} />
      <QuietGroup>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {lastSummary || t(lang, 'noResultYet')}
        </Text>
        {last ? (
          <AccessibleButton label={t(lang, 'repeat')} glyph={GLYPHS.repeat} onPress={repeatLastResult} variant="secondary" />
        ) : null}
      </QuietGroup>

    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
});
