import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import {
  COMMAND_REGISTRY,
  NativeVoiceCommandService,
  parseVoiceCommand,
} from '../ai/VoiceCommandService';
import { AccessibleButton } from '../components/AccessibleButton';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { spacing, typeScale } from '../theme/tokens';

const voiceService = new NativeVoiceCommandService();

export default function VoiceScreen() {
  const { settings, colors, update } = useSettings();
  const lang = settings.language;
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  const handleTranscript = async (text: string) => {
    setTranscript(text);
    setListening(false);
    const cmd = parseVoiceCommand(text);
    speechService.setRate(settings.speechRate);
    switch (cmd.action) {
      case 'describe':
        router.push('/detect');
        break;
      case 'read-text':
        router.push('/read');
        break;
      case 'repeat':
        await speechService.repeatLast();
        break;
      case 'stop':
        await speechService.stop();
        break;
      case 'change-language': {
        const next = lang === 'ar' ? 'en' : 'ar';
        await update({ language: next });
        void speechService.speak(next === 'ar' ? 'تم تغيير اللغة إلى العربية' : 'Language changed to English', next);
        break;
      }
      case 'open-settings':
        router.push('/settings');
        break;
      case 'go-home':
        router.replace('/');
        break;
      case 'obstacle-check':
        setFeedback(t(lang, 'commandNotPlanned'));
        void speechService.speak(t(lang, 'commandNotPlanned'), lang);
        break;
      default:
        setFeedback(t(lang, 'commandUnknown'));
        void speechService.speak(t(lang, 'commandUnknown'), lang);
    }
  };

  const start = async () => {
    setError('');
    setFeedback('');
    try {
      setListening(true);
      await voiceService.startListening(lang, handleTranscript, (e) => {
        setListening(false);
        setError(e.message);
      });
    } catch (e) {
      setListening(false);
      setError(e instanceof Error ? e.message : t(lang, 'errorGeneric'));
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <AccessibleButton
        label={listening ? t(lang, 'listening') : t(lang, 'tapToSpeak')}
        hint={t(lang, 'voiceHint')}
        onPress={start}
        disabled={listening}
      />
      {!!transcript && (
        <Text style={[styles.body, { color: colors.text }]}>
          {t(lang, 'yourCommand')}: {transcript}
        </Text>
      )}
      {!!feedback && (
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
          {feedback}
        </Text>
      )}
      {!!error && (
        <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.danger }]}>
          {error}
        </Text>
      )}
      <AccessibleButton label={t(lang, 'stopSpeaking')} onPress={() => void speechService.stop()} variant="secondary" />

      <Text style={[styles.heading, { color: colors.text }]}>{t(lang, 'supportedCommands')}</Text>
      {COMMAND_REGISTRY.map((c) => (
        <View
          key={c.action}
          style={[styles.cmdRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel={`${lang === 'ar' ? c.exampleAr : c.exampleEn} — ${c.implemented ? t(lang, 'implemented') : t(lang, 'planned')}`}
        >
          <Text style={[styles.body, { color: colors.text }]}>{lang === 'ar' ? c.exampleAr : c.exampleEn}</Text>
          <Text style={[styles.badge, { color: c.implemented ? colors.primary : colors.accent }]}>
            {c.implemented ? t(lang, 'implemented') : t(lang, 'planned')}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  heading: { fontSize: typeScale.heading, fontWeight: '700', marginTop: spacing.md },
  body: { fontSize: typeScale.body, lineHeight: 29 },
  cmdRow: {
    borderWidth: 1.5,
    borderRadius: 14,
    padding: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 60,
  },
  badge: { fontSize: typeScale.caption, fontWeight: '800' },
});
