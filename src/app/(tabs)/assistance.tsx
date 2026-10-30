/**
 * Assistance hub — every core accessibility function one tap away, plus
 * the global speech controls (Repeat / Stop speaking / Stop listening)
 * wired to the real services, and REAL permission statuses for camera
 * and microphone (read from the native modules on every focus — never
 * assumed). SOS lives here too (hazard system).
 */
import { useFocusEffect } from 'expo-router';
import { Camera } from 'expo-camera';
import React, { useCallback, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { voiceCommandService } from '../../ai/voiceSingleton';
import { AccessibleButton } from '../../components/AccessibleButton';
import { triggerSos } from '../../hazards/HazardService';
import { t, type StringKey } from '../../i18n/strings';
import { pushOnce } from '../../state/navGuard';
import { useSettings } from '../../state/SettingsContext';
import { radius, spacing } from '../../theme/tokens';

type PermState = 'granted' | 'denied' | 'undetermined' | 'unknown';

function permLabel(lang: 'ar' | 'en', state: PermState): string {
  const key: StringKey =
    state === 'granted' ? 'permGranted' : state === 'denied' ? 'permDenied' : 'permUndetermined';
  return t(lang, key);
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

  const permRow = (label: string, state: PermState) => (
    <View
      style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
      accessible
      accessibilityLabel={`${label}: ${permLabel(lang, state)}`}
    >
      <Text style={[styles.body, { color: colors.text, flex: 1, fontSize: type.body }]}>{label}</Text>
      <Text
        style={[
          styles.body,
          {
            fontSize: type.body,
            fontWeight: '700',
            color: state === 'granted' ? colors.success : state === 'denied' ? colors.danger : colors.textSecondary,
          },
        ]}
      >
        {permLabel(lang, state)}
      </Text>
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <AccessibleButton
        label={t(lang, 'startVoiceAssistant')}
        hint={t(lang, 'voiceHint')}
        onPress={() => pushOnce('/voice')}
      />
      <AccessibleButton label={t(lang, 'detect')} hint={t(lang, 'detectHint')} onPress={() => pushOnce('/detect')} variant="secondary" />
      <AccessibleButton label={t(lang, 'readText')} hint={t(lang, 'readTextHint')} onPress={() => pushOnce('/read')} variant="secondary" />
      <AccessibleButton label={t(lang, 'identifyObjects')} hint={t(lang, 'identifyObjectsHint')} onPress={() => pushOnce('/detect')} variant="secondary" />
      <AccessibleButton label={t(lang, 'places')} hint={t(lang, 'placesHint')} onPress={() => pushOnce('/places')} variant="secondary" />
      <AccessibleButton label={t(lang, 'viewAlerts')} onPress={() => pushOnce('/alerts')} variant="secondary" />

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text, fontSize: type.heading }]}>
        {t(lang, 'speak')}
      </Text>
      <AccessibleButton label={t(lang, 'repeat')} onPress={() => void speechService.repeatLast()} variant="secondary" />
      <AccessibleButton label={t(lang, 'stopSpeaking')} onPress={() => void speechService.stop()} variant="secondary" />
      <AccessibleButton label={t(lang, 'stopListening')} onPress={() => void voiceCommandService.stopListening()} variant="secondary" />

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text, fontSize: type.heading }]}>
        {t(lang, 'permissionsTitle')}
      </Text>
      {permRow(t(lang, 'cameraPermission'), cameraPerm)}
      {permRow(t(lang, 'micPermission'), micPerm)}
      {(cameraPerm === 'denied' || micPerm === 'denied') && (
        <AccessibleButton
          label={t(lang, 'openSystemSettings')}
          onPress={() => void Linking.openSettings()}
          variant="secondary"
        />
      )}

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text, fontSize: type.heading }]}>
        {t(lang, 'sosTitle')}
      </Text>
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'sosExpl')}</Text>
      <AccessibleButton label={t(lang, 'sosButton')} variant="danger" onPress={() => void onSos()} />
      {!!sosMessage && (
        <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {sosMessage}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  heading: { fontWeight: '700', marginTop: spacing.md },
  body: { lineHeight: 29 },
  row: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    gap: spacing.sm,
  },
});
