import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { t } from '../i18n/strings';
import { isAccessibilityBusy } from '../state/accessibilityBusy';
import { useSettings } from '../state/SettingsContext';
import { spacing, typeScale } from '../theme/tokens';
import { currentReleaseNote } from '../update/releaseNotes';
import { updateService, type UpdateStatus } from '../update/UpdateService';

export default function UpdatesScreen() {
  const { settings, colors } = useSettings();
  const lang = settings.language;
  const [status, setStatus] = useState<UpdateStatus>(() => updateService.getStatus());
  const [busyNow, setBusyNow] = useState(false);

  useEffect(() => updateService.subscribe(() => setStatus(updateService.getStatus())), []);

  const refreshBusy = useCallback(() => setBusyNow(isAccessibilityBusy()), []);
  useEffect(() => {
    const id = setInterval(refreshBusy, 1500);
    return () => clearInterval(id);
  }, [refreshBusy]);

  const check = async () => {
    const s = await updateService.checkAndDownload();
    setStatus(s);
    if (settings.announcements) {
      const msg =
        s.phase === 'ready'
          ? t(lang, 'updateReady')
          : s.phase === 'error'
            ? t(lang, 'updateError')
            : s.phase === 'unavailable'
              ? t(lang, 'updateUnavailable')
              : t(lang, 'updateUpToDate');
      void speechService.speakAnnouncement(msg, lang);
    }
  };

  const restart = async () => {
    const result = await updateService.restartToApply();
    if (!result.applied && result.reason === 'busy') {
      setBusyNow(true);
      if (settings.announcements) void speechService.speakAnnouncement(t(lang, 'updateBusyBlocked'), lang);
    }
    // On success the app reloads; nothing else to do here.
  };

  const note = currentReleaseNote();
  const phaseText =
    status.phase === 'checking'
      ? t(lang, 'updateChecking')
      : status.phase === 'downloading'
        ? t(lang, 'updateDownloading')
        : status.phase === 'ready'
          ? t(lang, 'updateReady')
          : status.phase === 'error'
            ? t(lang, 'updateError')
            : status.phase === 'unavailable'
              ? t(lang, 'updateUnavailable')
              : t(lang, 'updateUpToDate');

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t(lang, 'updates')}
      </Text>

      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.body, { color: colors.text }]}>
          {t(lang, 'updateRuntime')}: {status.runtimeVersion ?? '—'}
        </Text>
        <Text style={[styles.body, { color: colors.text }]}>
          {t(lang, 'updateChannel')}: {status.channel ?? '—'}
        </Text>
        <Text style={[styles.body, { color: colors.text }]}>
          {t(lang, 'updateCurrentId')}:{' '}
          {status.isEmbeddedLaunch || !status.currentUpdateId
            ? t(lang, 'updateEmbedded')
            : status.currentUpdateId}
        </Text>
        <Text style={[styles.body, { color: colors.text }]}>
          {t(lang, 'updateLastCheck')}: {status.lastCheckAt ?? t(lang, 'updateNeverChecked')}
        </Text>
      </View>

      <Text
        accessibilityLiveRegion="polite"
        style={[styles.bodyLarge, { color: status.phase === 'error' ? colors.danger : colors.text }]}
      >
        {phaseText}
      </Text>
      {status.phase === 'ready' && busyNow && (
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
          {t(lang, 'updateBusyBlocked')}
        </Text>
      )}

      <AccessibleButton
        label={t(lang, 'updateCheckNow')}
        onPress={() => void check()}
        disabled={status.phase === 'checking' || status.phase === 'downloading' || !status.available}
      />
      {status.phase === 'ready' && (
        <AccessibleButton
          label={t(lang, 'updateRestart')}
          onPress={() => void restart()}
          disabled={busyNow}
          variant="primary"
        />
      )}

      {note && (
        <View>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t(lang, 'updateReleaseNotes')}
          </Text>
          <Text style={[styles.bodyLarge, { color: colors.text }]}>
            {lang === 'ar' ? note.titleAr : note.titleEn} ({note.date})
          </Text>
          <Text style={[styles.body, { color: colors.text }]}>{lang === 'ar' ? note.bodyAr : note.bodyEn}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  heading: { fontSize: typeScale.heading, fontWeight: '700' },
  body: { fontSize: typeScale.body, lineHeight: 29 },
  bodyLarge: { fontSize: typeScale.bodyLarge, lineHeight: 32, fontWeight: '600' },
  card: { borderWidth: 1.5, borderRadius: 16, padding: spacing.md, gap: 6 },
});
