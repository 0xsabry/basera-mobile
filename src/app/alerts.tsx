/**
 * Safety alert history — hazard alerts (from scan-based checks) and SOS
 * events, stored on-device. Each event shows its REAL guardian
 * notification outcome; nothing here claims a delivery that did not
 * happen. The blind-spots section states plainly what the camera model
 * can never detect.
 *
 * V1.1 redesign: severity cards (glyph + level pill + outcome pill)
 * on the design system; storage and SOS logic unchanged.
 */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { COCO_LABELS_AR, COCO_LABELS_EN } from '../ai/cocoLabels';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import {
  ActionGrid,
  Banner,
  Card,
  CompactAction,
  EmptyState,
  Icon,
  Screen,
  SectionHeader,
  StatusPill,
  type Tone,
} from '../components/ui';
import { alertHistoryStore, type AlertEvent } from '../hazards/AlertHistoryStore';
import { acknowledgeHazards, hazardAlertText, triggerSos } from '../hazards/HazardService';
import { NOT_DETECTABLE, type HazardAlert } from '../hazards/RiskEngine';
import { t, type StringKey } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { spacing } from '../theme/tokens';

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

function notifyTone(outcome: AlertEvent['guardianNotify']): Tone {
  switch (outcome) {
    case 'sent':
      return 'success';
    case 'failed':
      return 'danger';
    case 'unavailable':
      return 'warning';
    default:
      return 'neutral';
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
    <Screen>
      {/* The limitation comes FIRST, as a slim banner — before any event. */}
      <Banner tone="info" glyph={GLYPHS.detect} title={t(lang, 'hazardScanNote')} />
      <Card tone="danger">
        <AccessibleButton label={t(lang, 'sosButton')} glyph={GLYPHS.sos} variant="danger" onPress={() => void onSos()} />
        {!!sosMessage && (
          <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {sosMessage}
          </Text>
        )}
      </Card>
      {events.some((e) => !e.acknowledged) && (
        <AccessibleButton
          label={t(lang, 'iAmOk')}
          glyph={GLYPHS.check}
          onPress={() => {
            void (async () => {
              await acknowledgeHazards();
              await refresh();
            })();
          }}
        />
      )}

      {events.length === 0 && <EmptyState glyph={GLYPHS.alerts} title={t(lang, 'alertsEmpty')} />}
      {events.map((e) => {
        const isHigh = e.level === 'high' && !e.acknowledged;
        return (
          <Card key={e.id} tone={isHigh ? 'danger' : undefined}>
            <View style={styles.pillRow}>
              <Icon
                glyph={isHigh || e.kind === 'sos' ? GLYPHS.alerts : GLYPHS.info}
                tone={isHigh || e.kind === 'sos' ? 'danger' : 'info'}
              />
              <Text style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge, flex: 1 }]}>
                {eventTitle(lang, e)}
              </Text>
              <StatusPill
                tone={e.level === 'high' ? 'danger' : 'warning'}
                glyph={GLYPHS.alerts}
                label={e.level === 'high' ? t(lang, 'hazardWarnPrefix') : t(lang, 'hazardCarefulPrefix')}
              />
            </View>
            <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
              {new Date(e.timestamp).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}
              {e.direction ? ` — ${e.direction}` : ''}
              {e.proximity ? ` — ${e.proximity}` : ''}
            </Text>
            <View style={styles.pillRow}>
              <Text style={[styles.body, { color: colors.text, fontSize: type.body, flex: 1 }]}>
                {t(lang, 'guardianNotifyLabel')}:
              </Text>
              <StatusPill tone={notifyTone(e.guardianNotify)} label={t(lang, notifyKey(e.guardianNotify))} />
            </View>
            <ActionGrid>
              <CompactAction label={t(lang, 'repeatWarning')} glyph={GLYPHS.repeat} onPress={() => repeatWarning(e)} />
              {!e.acknowledged && (
                <CompactAction
                  label={t(lang, 'iAmOk')}
                  glyph={GLYPHS.check}
                  variant="primary"
                  onPress={() => {
                    void (async () => {
                      await alertHistoryStore.acknowledge(e.id);
                      await refresh();
                    })();
                  }}
                />
              )}
              <CompactAction
                label={t(lang, 'delete')}
                variant="danger"
                onPress={() => {
                  void (async () => {
                    await alertHistoryStore.remove(e.id);
                    await refresh();
                  })();
                }}
              />
            </ActionGrid>
          </Card>
        );
      })}
      {events.length > 0 && (
        <AccessibleButton label={t(lang, 'clearAll')} variant="danger" onPress={confirmClear} />
      )}

      <SectionHeader title={t(lang, 'alertsBlindSpotsTitle')} glyph={GLYPHS.glasses} tone="warning" />
      <Card>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {t(lang, 'alertsBlindSpotsBody')}
        </Text>
        {NOT_DETECTABLE.map((b) => (
          <Text key={b.en} style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            • {lang === 'ar' ? b.ar : b.en}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
  bodyLarge: { lineHeight: 32, fontWeight: '700' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
