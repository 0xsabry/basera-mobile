/**
 * Updates — OTA status + release notes. V1.1 redesign: status card
 * with a phase pill, release notes presented as a proper card. The
 * update service calls and the busy-guard are unchanged.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { Card, QuietGroup, Screen, SectionHeader, StatusPill, type Tone } from '../components/ui';
import { t } from '../i18n/strings';
import { isAccessibilityBusy } from '../state/accessibilityBusy';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { spacing } from '../theme/tokens';
import { currentReleaseNote } from '../update/releaseNotes';
import { updateService, type UpdateStatus } from '../update/UpdateService';

function phaseTone(phase: UpdateStatus['phase']): Tone {
  switch (phase) {
    case 'ready':
      return 'success';
    case 'error':
      return 'danger';
    case 'checking':
    case 'downloading':
      return 'info';
    case 'unavailable':
      return 'warning';
    default:
      return 'neutral';
  }
}

export default function UpdatesScreen() {
  const { settings, colors, type } = useSettings();
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
    if (!result.applied) setStatus(updateService.getStatus());
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

  const infoRow = (label: string, value: string) => (
    <View style={styles.infoRow}>
      <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>{label}</Text>
      <Text style={[styles.body, styles.infoValue, { color: colors.text, fontSize: type.body }]}>{value}</Text>
    </View>
  );

  return (
    <Screen>
      <SectionHeader title={t(lang, 'updates')} glyph={GLYPHS.updates} />

      <QuietGroup>
        {infoRow(t(lang, 'updateRuntime'), status.runtimeVersion ?? '—')}
        {infoRow(t(lang, 'updateChannel'), status.channel ?? '—')}
        {infoRow(
          t(lang, 'updateCurrentId'),
          status.isEmbeddedLaunch || !status.currentUpdateId ? t(lang, 'updateEmbedded') : status.currentUpdateId,
        )}
        {infoRow(t(lang, 'updateLastCheck'), status.lastCheckAt ?? t(lang, 'updateNeverChecked'))}
      </QuietGroup>

      {status.phase === 'ready' && busyNow && (
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {t(lang, 'updateBusyBlocked')}
        </Text>
      )}

      <AccessibleButton
        label={t(lang, 'updateCheckNow')}
        glyph={GLYPHS.updates}
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

      {/* The one raised surface on this screen: phase + release note. */}
      {note && <SectionHeader title={t(lang, 'updateReleaseNotes')} glyph={GLYPHS.info} />}
      <Card variant="raised">
        <View style={styles.infoRow}>
          <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
            {t(lang, 'assistantStatus')}
          </Text>
          <StatusPill tone={phaseTone(status.phase)} glyph={GLYPHS.updates} label={phaseText} />
        </View>
        {note && (
          <>
            <Text style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>
              {lang === 'ar' ? note.titleAr : note.titleEn}
            </Text>
            <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>{note.date}</Text>
            <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
              {lang === 'ar' ? note.bodyAr : note.bodyEn}
            </Text>
          </>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
  bodyLarge: { lineHeight: 32, fontWeight: '600' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoValue: { flex: 1, fontWeight: '600' },
});
