/**
 * Home — the command center, rebuilt on the V1.1 design system.
 *
 * Strict priority order: slim brand header (the greeting is the
 * display element), one hero voice action (assistant readiness lives
 * in its state label), an honest one-row glasses StatusStrip (not
 * connected — no paragraph), a 2×2 core action grid (detect, read,
 * places, alerts — ONE accent, tones are not decorative), a family
 * StatusStrip carrying the REAL sharing state, then the contextual
 * items: the active-alert banner, the last result as a quiet row
 * with Repeat, and — only when the guardian service is actually
 * unconfigured — the service note banner last.
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

      {/* Smart glasses — honest NotAvailable state, one slim row. */}
      <StatusStrip
        glyph={GLYPHS.glasses}
        title={t(lang, 'glassesCardTitle')}
        pillLabel={t(lang, 'glassesCardStatus')}
        pillTone="neutral"
        pillGlyph={GLYPHS.glasses}
      />

      {/* Core actions — exactly 2×2, one accent for all four. */}
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
  body: { lineHeight: 29 },
});
