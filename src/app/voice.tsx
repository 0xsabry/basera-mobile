import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import {
  COMMAND_REGISTRY,
  parseVoiceCommand,
  voiceErrorMessageKey,
} from '../ai/VoiceCommandService';
import { voiceCommandService } from '../ai/voiceSingleton';
import { AccessibleButton } from '../components/AccessibleButton';
import { acknowledgeHazards, triggerSos } from '../hazards/HazardService';
import { t } from '../i18n/strings';
import { getCurrentFix } from '../places/currentFix';
import { PlacesAssistant } from '../places/PlacesAssistant';
import { placesStore } from '../places/PlacesStore';
import { setAccessibilityBusy } from '../state/accessibilityBusy';
import { useSettings } from '../state/SettingsContext';
import { spacing, typeScale } from '../theme/tokens';

const voiceService = voiceCommandService;

export default function VoiceScreen() {
  const { settings, colors, update } = useSettings();
  const lang = settings.language;
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  // OTA safety: no update reload while recognition is live.
  useEffect(() => {
    setAccessibilityBusy('recognition', listening);
  }, [listening]);
  useEffect(() => {
    return () => setAccessibilityBusy('recognition', false);
  }, []);

  // Place Memory voice flows: a pending state consumes the NEXT
  // utterance (a place name, a note, or a yes/no confirmation) instead
  // of parsing it as a fresh command.
  type PendingPlace =
    | { kind: 'place-name' }
    | { kind: 'place-note'; placeName: string | null }
    | { kind: 'delete-place'; placeName: string };
  const pendingRef = useRef<PendingPlace | null>(null);
  const say = (msg: string) => {
    setFeedback(msg);
    void speechService.speakAnnouncement(msg, lang);
  };

  const handleTranscript = async (text: string) => {
    setTranscript(text);
    setListening(false);
    speechService.setRate(settings.speechRate);
    // Built per utterance so it always reads the current settings.
    const assistant = new PlacesAssistant({
      store: placesStore,
      getFix: () => getCurrentFix(true),
      proximityRadiusM: () => settings.proximityRadiusM,
    });

    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      const value = text.trim();
      if (pending.kind === 'place-name') {
        say(await assistant.savePlace(lang, value));
        return;
      }
      if (pending.kind === 'place-note') {
        say(await assistant.addNote(lang, pending.placeName, value));
        return;
      }
      // delete-place: explicit yes required; anything else cancels.
      const yes = /^(yes|yeah|ok|أيوه|ايوه|نعم|تمام)$/i.test(value.replace(/[.؟?]/g, ''));
      say(yes ? await assistant.deletePlace(lang, pending.placeName) : t(lang, 'cancel'));
      return;
    }

    const cmd = parseVoiceCommand(text);
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
        void speechService.speakAnnouncement(next === 'ar' ? 'تم تغيير اللغة إلى العربية' : 'Language changed to English', next);
        break;
      }
      case 'sos': {
        const outcome = await triggerSos(lang);
        setFeedback(outcome.message);
        break;
      }
      case 'acknowledge-ok':
        await acknowledgeHazards();
        setFeedback(t(lang, 'alertsAcknowledged'));
        void speechService.speakAnnouncement(t(lang, 'alertsAcknowledged'), lang);
        break;
      case 'save-place':
        if (cmd.argument) {
          say(await assistant.savePlace(lang, cmd.argument));
        } else {
          pendingRef.current = { kind: 'place-name' };
          say(t(lang, 'placesVoiceAskName'));
        }
        break;
      case 'save-place-unnamed':
        pendingRef.current = { kind: 'place-name' };
        say(t(lang, 'placesVoiceAskName'));
        break;
      case 'add-place-note':
        pendingRef.current = { kind: 'place-note', placeName: cmd.argument ?? null };
        say(t(lang, 'placesVoiceAskNote'));
        break;
      case 'list-places':
        say(await assistant.listPlaces(lang));
        break;
      case 'find-place':
        say(cmd.argument ? await assistant.findPlace(lang, cmd.argument) : t(lang, 'placesVoiceNotFound'));
        break;
      case 'near-place':
        say(cmd.argument ? await assistant.nearPlace(lang, cmd.argument) : t(lang, 'placesVoiceNoLocation'));
        break;
      case 'delete-place': {
        if (!cmd.argument) {
          say(t(lang, 'placesVoiceNotFound'));
          break;
        }
        const target = await placesStore.findByName(cmd.argument);
        if (!target) {
          say(t(lang, 'placesVoiceNotFound'));
          break;
        }
        pendingRef.current = { kind: 'delete-place', placeName: target.name };
        say(`${t(lang, 'placesVoiceAskDeleteConfirm')}: ${target.name}? ${t(lang, 'placesVoiceSayYesNo')}`);
        break;
      }
      case 'describe-place':
        say(assistant.repeatDescription(lang));
        break;
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

  // Never leave a recognition session (and its subscriptions) running
  // after the screen loses focus or unmounts.
  useEffect(() => {
    return () => {
      void voiceService.stopListening();
    };
  }, []);
  useFocusEffect(
    useCallback(() => {
      return () => {
        void voiceService.stopListening();
        setListening(false);
      };
    }, []),
  );

  const stopListening = async () => {
    await voiceService.stopListening();
    setListening(false);
  };

  const start = async () => {
    setError('');
    setFeedback('');
    try {
      setListening(true);
      await voiceService.startListening(
        lang,
        handleTranscript,
        (e) => {
          setListening(false);
          // Localized message only — never a raw native error string.
          setError(t(lang, voiceErrorMessageKey(e)));
        },
        () => setListening(false),
      );
    } catch (e) {
      setListening(false);
      setError(t(lang, voiceErrorMessageKey(e)));
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
      {listening && (
        <AccessibleButton label={t(lang, 'stopListening')} onPress={() => void stopListening()} variant="secondary" />
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
