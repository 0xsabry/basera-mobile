/**
 * Safety alert history — hazard alerts (from scan-based checks) and SOS
 * events, stored on-device. Each event shows its REAL guardian
 * notification outcome; nothing here claims a delivery that did not
 * happen. The blind-spots section states plainly what the camera model
 * can never detect.
 */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COCO_LABELS_AR, COCO_LABELS_EN } from '../ai/cocoLabels';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { alertHistoryStore, type AlertEvent } from '../hazards/AlertHistoryStore';
import { acknowledgeHazards, hazardAlertText, triggerSos } from '../hazards/HazardService';
import { NOT_DETECTABLE, type HazardAlert } from '../hazards/RiskEngine';
import { t, type StringKey } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { radius, spacing } from '../theme/tokens';

function notifyKey(outcome: AlertEvent['guardianNotify']): StringKey {
  switch (outcome) {
    case 'sent':
      return 'notifySent';
    case 'failed':
      return 'notifyFailed';
    case 'unavailable':
      return 'notifyUnavailable';
    default:
      return 'notifyNotAttempted';
  }
}

function eventTitle(lang: 'ar' | 'en', e: AlertEvent): string {
  if (e.kind === 'sos') return t(lang, 'sosTitle');
  const idx = COCO_LABELS_EN.indexOf(e.className);
  const label = lang === 'ar' ? (COCO_LABELS_AR[idx] ?? e.className) : e.className;
  const prefix = e.level === 'high' ? t(lang, 'hazardWarnPrefix') : t(lang, 'hazardCarefulPrefix');
  return `${prefix} ${label}`;
}

export default function AlertsScreen() {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [sosMessage, setSosMessage] = useState('');

  const refresh = useCallback(async () => {
    setEvents(await alertHistoryStore.list());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const repeatWarning = (e: AlertEvent) => {
    if (e.kind === 'sos') {
      void speechService.speakAlert(`${t(lang, 'sosTitle')} — ${t(lang, notifyKey(e.guardianNotify))}`, lang);
      return;
    }
    const idx = COCO_LABELS_EN.indexOf(e.className);
    const pseudo: HazardAlert = {
      className: e.className,
      labelEn: e.className,
      labelAr: COCO_LABELS_AR[idx] ?? e.className,
      category: e.category === 'sos' ? 'vehicle' : e.category,
      confidence: 0,
      direction: e.direction ?? 'center',
      proximity: e.proximity ?? 'near',
      level: e.level,
      id: e.id,
      at: e.timestamp,
      escalated: false,
    };
    void speechService.speakAlert(hazardAlertText(lang, pseudo), lang);
  };

  const confirmClear = () => {
    Alert.alert(t(lang, 'clearAll'), t(lang, 'clearConfirm'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      {
        text: t(lang, 'confirm'),
        style: 'destructive',
        onPress: async () => {
          await alertHistoryStore.clear();
          await refresh();
        },
      },
    ]);
  };

  const onSos = async () => {
    const outcome = await triggerSos(lang);
    setSosMessage(outcome.message);
    await refresh();
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'hazardScanNote')}</Text>
      <AccessibleButton label={t(lang, 'sosButton')} variant="danger" onPress={() => void onSos()} />
      {!!sosMessage && (
        <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {sosMessage}
        </Text>
      )}
      {events.some((e) => !e.acknowledged) && (
        <AccessibleButton
          label={t(lang, 'iAmOk')}
          onPress={() => {
            void (async () => {
              await acknowledgeHazards();
              await refresh();
            })();
          }}
        />
      )}

      {events.length === 0 && (
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'alertsEmpty')}</Text>
      )}
      {events.map((e) => (
        <View
          key={e.id}
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: e.level === 'high' && !e.acknowledged ? colors.danger : colors.border,
            },
          ]}
        >
          <Text style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>
            {eventTitle(lang, e)}
          </Text>
          <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
            {new Date(e.timestamp).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}
            {e.direction ? ` — ${e.direction}` : ''}
            {e.proximity ? ` — ${e.proximity}` : ''}
          </Text>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {t(lang, 'guardianNotifyLabel')}: {t(lang, notifyKey(e.guardianNotify))}
          </Text>
          <AccessibleButton label={t(lang, 'repeatWarning')} variant="secondary" onPress={() => repeatWarning(e)} />
          {!e.acknowledged && (
            <AccessibleButton
              label={t(lang, 'iAmOk')}
              variant="secondary"
              onPress={() => {
                void (async () => {
                  await alertHistoryStore.acknowledge(e.id);
                  await refresh();
                })();
              }}
            />
          )}
          <AccessibleButton
            label={t(lang, 'delete')}
            variant="danger"
            onPress={() => {
              void (async () => {
                await alertHistoryStore.remove(e.id);
                await refresh();
              })();
            }}
          />
        </View>
      ))}
      {events.length > 0 && (
        <AccessibleButton label={t(lang, 'clearAll')} variant="danger" onPress={confirmClear} />
      )}

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text, fontSize: type.heading }]}>
        {t(lang, 'alertsBlindSpotsTitle')}
      </Text>
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
        {t(lang, 'alertsBlindSpotsBody')}
      </Text>
      {NOT_DETECTABLE.map((b) => (
        <Text key={b.en} style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          • {lang === 'ar' ? b.ar : b.en}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  heading: { fontWeight: '700', marginTop: spacing.md },
  body: { lineHeight: 29 },
  bodyLarge: { lineHeight: 32, fontWeight: '700' },
  card: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, gap: 6 },
});
