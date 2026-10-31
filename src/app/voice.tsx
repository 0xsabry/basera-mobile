/**
 * Voice assistant — V1.1 redesign: a mic hero with an explicit state
 * machine (idle / listening / error), drawn as a large disc whose
 * tone AND text label change with state (never color alone), plus
 * design-system command rows. Recognition, command parsing, place
 * flows and cleanup logic are unchanged.
 */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import {
  COMMAND_REGISTRY,
  parseVoiceCommand,
  voiceErrorMessageKey,
} from '../ai/VoiceCommandService';
import { voiceCommandService } from '../ai/voiceSingleton';
import { AccessibleButton } from '../components/AccessibleButton';
import { Banner, ListRow, QuietGroup, Screen, SectionHeader, StatusPill } from '../components/ui';
import { acknowledgeHazards, triggerSos } from '../hazards/HazardService';
import { t } from '../i18n/strings';
import { getCurrentFix } from '../places/currentFix';
import { PlacesAssistant } from '../places/PlacesAssistant';
import { placesStore } from '../places/PlacesStore';
import { setAccessibilityBusy } from '../state/accessibilityBusy';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { elevation, radius, spacing } from '../theme/tokens';

const voiceService = voiceCommandService;

export default function VoiceScreen() {
  const { settings, colors, type, update } = useSettings();
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
    if (listening) return; // duplicate-tap guard (same pattern as detect/read)
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

  const pressOpacity = settings.reducedMotion ? 1 : 0.88;
  const stateLabel = listening ? t(lang, 'listening') : error ? t(lang, 'errorGeneric') : t(lang, 'voiceHeroState');
  const discColor = listening ? colors.danger : error ? colors.warning : colors.heroBackground;
  const discTextColor = listening ? '#FFFFFF' : error ? colors.onWarningSoft : colors.heroText;

  return (
    <Screen>
      {/* Mic hero — state machine: idle → listening → (result | error). */}
      <View style={styles.heroWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={listening ? t(lang, 'listening') : t(lang, 'tapToSpeak')}
          accessibilityHint={t(lang, 'voiceHint')}
          accessibilityState={{ disabled: listening, busy: listening }}
          disabled={listening}
          onPress={() => void start()}
          style={({ pressed }) => [
            styles.discRing,
            { borderColor: discColor, opacity: pressed ? pressOpacity : 1 },
          ]}
        >
          <View style={[styles.disc, { backgroundColor: discColor, shadowColor: colors.shadow }]}>
            <Text style={{ color: discTextColor, fontSize: 56, fontWeight: '800', lineHeight: 66 }}>
              {GLYPHS.voice}
            </Text>
          </View>
        </Pressable>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.stateText, { color: colors.text, fontSize: type.bodyLarge }]}
        >
          {listening ? t(lang, 'listening') : t(lang, 'tapToSpeak')}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: type.body, lineHeight: type.body * 1.4 }}>
          {stateLabel}
        </Text>
      </View>

      {!!transcript && (
        <QuietGroup>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {t(lang, 'yourCommand')}: {transcript}
          </Text>
        </QuietGroup>
      )}
      {!!feedback && (
        <QuietGroup>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {feedback}
          </Text>
        </QuietGroup>
      )}
      {!!error && (
        <Banner tone="danger" title={t(lang, 'errorGeneric')}>
          <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {error}
          </Text>
        </Banner>
      )}
      {listening && (
        <AccessibleButton label={t(lang, 'stopListening')} glyph={GLYPHS.stop} onPress={() => void stopListening()} variant="secondary" />
      )}
      <AccessibleButton label={t(lang, 'stopSpeaking')} glyph={GLYPHS.stop} onPress={() => void speechService.stop()} variant="secondary" />

      <SectionHeader title={t(lang, 'supportedCommands')} glyph={GLYPHS.voice} />
      <QuietGroup>
        {COMMAND_REGISTRY.map((c) => (
          <ListRow
            key={c.action}
            variant="quiet"
            glyph={GLYPHS.voice}
            tone={c.implemented ? 'primary' : 'neutral'}
            title={lang === 'ar' ? c.exampleAr : c.exampleEn}
            accessibilityLabel={`${lang === 'ar' ? c.exampleAr : c.exampleEn} — ${c.implemented ? t(lang, 'implemented') : t(lang, 'planned')}`}
            right={
              <StatusPill
                tone={c.implemented ? 'success' : 'neutral'}
                label={c.implemented ? t(lang, 'implemented') : t(lang, 'planned')}
              />
            }
          />
        ))}
      </QuietGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroWrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  discRing: {
    borderWidth: 3,
    borderRadius: radius.pill,
    padding: 10,
  },
  disc: {
    width: 132,
    height: 132,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: elevation.hero,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  stateText: { fontWeight: '800', textAlign: 'center' },
  body: { lineHeight: 29 },
});
