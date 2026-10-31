/**
 * Assistance hub — every core accessibility function one tap away, plus
 * the global speech controls (Repeat / Stop speaking / Stop listening)
 * wired to the real services, and REAL permission statuses for camera
 * and microphone (read from the native modules on every focus — never
 * assumed). SOS lives here too (hazard system).
 *
 * V1.1 redesign: composed from the design system (hero + feature
 * tiles + status rows) — all handlers and permission logic unchanged.
 */
import { useFocusEffect } from 'expo-router';
import { Camera } from 'expo-camera';
import React, { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { voiceCommandService } from '../../ai/voiceSingleton';
import { AccessibleButton } from '../../components/AccessibleButton';
import {
  Banner,
  FeatureGrid,
  FeatureTile,
  HeroAction,
  ListRow,
  QuietGroup,
  Screen,
  SectionHeader,
  StatusPill,
  type Tone,
} from '../../components/ui';
import { triggerSos } from '../../hazards/HazardService';
import { t, type StringKey } from '../../i18n/strings';
import { pushOnce } from '../../state/navGuard';
import { useSettings } from '../../state/SettingsContext';
import { GLYPHS } from '../../theme/glyphs';

type PermState = 'granted' | 'denied' | 'undetermined' | 'unknown';

function permLabel(lang: 'ar' | 'en', state: PermState): string {
  const key: StringKey =
    state === 'granted' ? 'permGranted' : state === 'denied' ? 'permDenied' : 'permUndetermined';
  return t(lang, key);
}

function permTone(state: PermState): Tone {
  return state === 'granted' ? 'success' : state === 'denied' ? 'danger' : 'neutral';
}

export default function AssistanceScreen() {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;
  const [cameraPerm, setCameraPerm] = useState<PermState>('unknown');
  const [micPerm, setMicPerm] = useState<PermState>('unknown');
  const [sosMessage, setSosMessage] = useState('');

  const refreshPerms = useCallback(async () => {
    try {
      const cam = await Camera.getCameraPermissionsAsync();
      setCameraPerm(cam.granted ? 'granted' : cam.canAskAgain ? 'undetermined' : 'denied');
    } catch {
      setCameraPerm('unknown');
    }
    try {
      const mic = await Camera.getMicrophonePermissionsAsync();
      setMicPerm(mic.granted ? 'granted' : mic.canAskAgain ? 'undetermined' : 'denied');
    } catch {
      setMicPerm('unknown');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPerms();
    }, [refreshPerms]),
  );

  const onSos = async () => {
    const outcome = await triggerSos(lang);
    setSosMessage(outcome.message);
    if (settings.announcements) {
      void speechService.speakAnnouncement(outcome.message, lang);
    }
  };

  return (
    <Screen>
      <HeroAction
        label={t(lang, 'startVoiceAssistant')}
        hint={t(lang, 'voiceHint')}
        stateLabel={t(lang, 'voiceHeroState')}
        glyph={GLYPHS.voice}
        onPress={() => pushOnce('/voice')}
      />
      {/* Core actions — the same four as Home, in the same 2×2 grid
          (v1.1.2: identical composition on both surfaces). */}
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

      <SectionHeader title={t(lang, 'speak')} glyph={GLYPHS.speak} />
      <QuietGroup>
        <ListRow
          variant="quiet"
          glyph={GLYPHS.repeat}
          title={t(lang, 'repeat')}
          onPress={() => void speechService.repeatLast()}
        />
        <ListRow
          variant="quiet"
          glyph={GLYPHS.stop}
          title={t(lang, 'stopSpeaking')}
          onPress={() => void speechService.stop()}
        />
        <ListRow
          variant="quiet"
          glyph={GLYPHS.stop}
          title={t(lang, 'stopListening')}
          onPress={() => void voiceCommandService.stopListening()}
        />
      </QuietGroup>

      <SectionHeader title={t(lang, 'permissionsTitle')} glyph={GLYPHS.shield} />
      <QuietGroup>
        <ListRow
          variant="quiet"
          glyph={GLYPHS.camera}
          title={t(lang, 'cameraPermission')}
          right={<StatusPill tone={permTone(cameraPerm)} label={permLabel(lang, cameraPerm)} />}
        />
        <ListRow
          variant="quiet"
          glyph={GLYPHS.mic}
          title={t(lang, 'micPermission')}
          right={<StatusPill tone={permTone(micPerm)} label={permLabel(lang, micPerm)} />}
        />
      </QuietGroup>
      {(cameraPerm === 'denied' || micPerm === 'denied') && (
        <AccessibleButton
          label={t(lang, 'openSystemSettings')}
          onPress={() => void Linking.openSettings()}
          variant="secondary"
        />
      )}

      {/* SOS — one distinct danger strip at the bottom. */}
      <Banner tone="danger" glyph={GLYPHS.sos} title={t(lang, 'sosTitle')}>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'sosExpl')}</Text>
        <AccessibleButton label={t(lang, 'sosButton')} glyph={GLYPHS.sos} variant="danger" onPress={() => void onSos()} />
        {!!sosMessage && (
          <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {sosMessage}
          </Text>
        )}
      </Banner>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
});
