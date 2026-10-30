import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { AccessibleButton } from '../../components/AccessibleButton';
import { QrCodeView } from '../../components/QrCodeView';
import {
  getGuardianService,
  type GuardianLink,
  type GuardianUser,
  type PairingCode,
} from '../../guardian/GuardianService';
import {
  getLocationSharingService,
  type DeletionStatus,
} from '../../guardian/LocationSharingService';
import { getBackgroundLocationService } from '../../guardian/BackgroundLocationService';
import { offlineLocationQueue } from '../../guardian/OfflineLocationQueue';
import { deletionServerMessageKey } from '../../guardian/PendingDeletion';
import { formatPairingCode } from '../../guardian/pairing';
import { deriveSharingState, type SharingState } from '../../guardian/sharingState';
import { getSupabaseClient } from '../../guardian/supabaseClient';
import { getLastSuccessfulUploadAt } from '../../guardian/uploadMeta';
import { triggerSos } from '../../hazards/HazardService';
import { t, type StringKey } from '../../i18n/strings';
import { useSettings } from '../../state/SettingsContext';
import { MIN_TOUCH, spacing, typeScale } from '../../theme/tokens';

const SHARING_STATE_KEY: Record<SharingState, StringKey> = {
  off: 'sharingStateOff',
  'foreground-only': 'sharingStateForegroundOnly',
  'background-active': 'sharingStateBackgroundActive',
  'permission-denied': 'sharingStatePermissionDenied',
  'gps-unavailable': 'sharingStateGpsUnavailable',
  'offline-queueing': 'sharingStateOfflineQueueing',
  'sync-pending': 'sharingStateSyncPending',
};

export default function GuardianScreen() {
  const { settings, colors, update } = useSettings();
  const lang = settings.language;
  const service = getGuardianService();
  const [sharing] = useState(() => getLocationSharingService());
  const sharingRef = useRef(sharing);
  const [deletion, setDeletion] = useState<DeletionStatus>(() => sharing.deletionStatus);

  const [user, setUser] = useState<GuardianUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [requests, setRequests] = useState<GuardianLink[]>([]);
  const [guardians, setGuardians] = useState<GuardianLink[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Background tracking + derived sharing state (real signal reads).
  const [bgStarted, setBgStarted] = useState(false);
  const [bgDenied, setBgDenied] = useState(false);
  const [bgMessage, setBgMessage] = useState('');
  const [lastUploadAt, setLastUploadAt] = useState<number | null>(null);
  const [queueLen, setQueueLen] = useState(0);
  const [sharingState, setSharingState] = useState<SharingState>('off');

  const refreshBg = useCallback(async () => {
    const bg = getBackgroundLocationService();
    const [started, servicesOn, fgGranted, queued, lastUp] = await Promise.all([
      bg.hasStarted(),
      bg.servicesEnabled(),
      bg.foregroundGranted(),
      offlineLocationQueue.count(),
      getLastSuccessfulUploadAt(),
    ]);
    setBgStarted(started);
    setQueueLen(queued);
    setLastUploadAt(lastUp);
    setSharingState(
      deriveSharingState({
        sharingOn: settings.guardianSharingEnabled,
        servicesEnabled: servicesOn,
        foregroundGranted: fgGranted,
        backgroundStarted: started,
        offlineQueueLength: queued,
        configured: getSupabaseClient() !== null,
        lastUploadAt: lastUp,
      }),
    );
  }, [settings.guardianSharingEnabled]);

  useFocusEffect(
    useCallback(() => {
      void refreshBg();
    }, [refreshBg]),
  );

  // If the user opted into background sharing, make sure the OS task
  // is actually running when this screen opens (it survives reboots
  // natively, but permission can be revoked in system settings — the
  // service refuses then, and the status above shows the truth).
  useEffect(() => {
    if (settings.backgroundSharingEnabled && settings.guardianSharingEnabled) {
      void getBackgroundLocationService()
        .startBackgroundUpdates(lang)
        .then(() => refreshBg())
        .catch(() => undefined);
    }
  }, [settings.backgroundSharingEnabled, settings.guardianSharingEnabled, lang, refreshBg]);

  const enableBackground = async () => {
    setBgMessage('');
    setBgDenied(false);
    if (!settings.guardianSharingEnabled) {
      setBgMessage(t(lang, 'bgTrackingNeedsSharing'));
      return;
    }
    const bg = getBackgroundLocationService();
    const granted = await bg.requestBackgroundPermission();
    if (!granted) {
      setBgDenied(true);
      setBgMessage(t(lang, 'bgTrackingDenied'));
      return;
    }
    const result = await bg.startBackgroundUpdates(lang);
    if (result === 'permission-denied') {
      setBgDenied(true);
      setBgMessage(t(lang, 'bgTrackingDenied'));
      return;
    }
    await update({ backgroundSharingEnabled: true });
    await refreshBg();
  };

  const disableBackground = async () => {
    await getBackgroundLocationService().stopBackgroundUpdates();
    await update({ backgroundSharingEnabled: false });
    await refreshBg();
  };

  const refresh = useCallback(async () => {
    const u = await service.getCurrentUser();
    setUser(u);
    if (u) {
      const [req, mine] = await Promise.all([
        service.listPendingRequests().catch(() => []),
        service.listMyGuardians().catch(() => []),
      ]);
      setRequests(req);
      setGuardians(mine);
    }
    setLoaded(true);
  }, [service]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Server-deletion state: subscribe for live updates and retry any
  // persisted pending deletion whenever this screen mounts (one of the
  // app-activity retry triggers; launch + foreground are wired too).
  useEffect(() => sharing.subscribeDeletionStatus(() => setDeletion(sharing.deletionStatus)), [sharing]);
  useEffect(() => {
    void sharing.initDeletion();
  }, [sharing]);

  // If consent is on and we are signed in, (re)start foreground sharing
  // when this screen opens; collection always pauses off-screen (the
  // service itself also stops on app background).
  useEffect(() => {
    if (user && settings.guardianSharingEnabled) {
      void sharingRef.current?.start();
    }
  }, [user, settings.guardianSharingEnabled]);

  useEffect(() => {
    const svc = sharing;
    return () => {
      void svc.stopWatching();
    };
  }, [sharing]);

  const toggleSharing = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (on) {
        // Consent copy is visible on this screen before the system prompt.
        const result = await sharingRef.current?.start();
        if (result === 'permission-denied') {
          setMessage(t(lang, 'guardianPermissionDenied'));
          await update({ guardianSharingEnabled: false });
          return;
        }
        await update({ guardianSharingEnabled: true });
        if (settings.announcements) {
          void speechService.speakAnnouncement(t(lang, 'guardianSharingOn'), lang);
        }
      } else {
        await sharingRef.current?.disableSharing();
        await update({ guardianSharingEnabled: false, backgroundSharingEnabled: false });
        void refreshBg();
        if (sharingRef.current?.deletionStatus.state === 'pending') {
          // Local off is done, but the server has NOT confirmed deletion.
          setMessage(t(lang, 'guardianDeletionPending'));
        }
        if (settings.announcements) {
          void speechService.speakAnnouncement(t(lang, 'guardianSharingOff'), lang);
        }
      }
    } catch {
      setMessage(t(lang, 'errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const createCode = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const c = await service.createPairingCode();
      setCode(c);
      if (settings.announcements) {
        void speechService.speakAnnouncement(`${t(lang, 'guardianYourCode')}: ${c.code}`, lang);
      }
    } catch {
      setMessage(t(lang, 'errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const actOnRequest = async (link: GuardianLink, approve: boolean) => {
    try {
      if (approve) await service.approveLink(link.id);
      else await service.denyLink(link.id);
      await refresh();
    } catch {
      setMessage(t(lang, 'errorGeneric'));
    }
  };

  const revoke = (link: GuardianLink) => {
    Alert.alert(t(lang, 'guardianRevoke'), t(lang, 'guardianRevokeConfirm'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      {
        text: t(lang, 'confirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              if (guardians.length === 1) {
                // Last guardian: record the persisted deletion obligation
                // FIRST (works offline), which re-drives the revoke +
                // purge and retries until the server confirms — never
                // fire-and-forget.
                await sharingRef.current?.requestServerDeletion('last-guardian-revoked', link.id);
              } else {
                await service.revokeLink(link.id);
              }
              await refresh();
            } catch {
              setMessage(t(lang, 'errorGeneric'));
            }
          })();
        },
      },
    ]);
  };

  if (!service.isConfigured()) {
    return (
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
          {t(lang, 'guardian')}
        </Text>
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
          {t(lang, 'guardianNotConfigured')}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t(lang, 'guardian')}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{t(lang, 'guardianLocationNote')}</Text>

      {loaded && !user && (
        <View>
          <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'guardianSignInNeeded')}</Text>
          <AccessibleButton label={t(lang, 'guardianOpenSignIn')} onPress={() => router.push('/guardian-auth')} />
        </View>
      )}

      {user && (
        <View>
          <Text style={[styles.body, { color: colors.text }]}>
            {t(lang, 'guardianSignedInAs')}: {user.email ?? user.id}
          </Text>
          <AccessibleButton
            label={t(lang, 'guardianSignOut')}
            variant="secondary"
            onPress={() => {
              void (async () => {
                // Purge first (needs the session), then sign out.
                if (settings.guardianSharingEnabled) {
                  await sharingRef.current?.disableSharing().catch(() => undefined);
                  await update({ guardianSharingEnabled: false });
                } else {
                  await sharingRef.current?.stopWatching();
                }
                await service.signOut().catch(() => undefined);
                await refresh();
              })();
            }}
          />

          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t(lang, 'guardianSharing')}
          </Text>
          <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'guardianSharingExpl')}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{t(lang, 'guardianPermissionExpl')}</Text>
          <View
            style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
            accessible
            accessibilityLabel={t(lang, 'guardianSharing')}
          >
            <Text style={[styles.body, { color: colors.text, flex: 1 }]}>
              {settings.guardianSharingEnabled ? t(lang, 'guardianSharingOn') : t(lang, 'guardianSharingOff')}
            </Text>
            <Switch
              accessibilityLabel={t(lang, 'guardianSharing')}
              value={settings.guardianSharingEnabled}
              onValueChange={(v) => void toggleSharing(v)}
              trackColor={{ true: colors.primary }}
            />
          </View>

          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t(lang, 'guardianPrivacyTitle')}
          </Text>
          {/* Local truth — always exact, works offline. */}
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
            {settings.guardianSharingEnabled ? t(lang, 'guardianSharingOn') : t(lang, 'guardianLocalOff')}
          </Text>
          {/* Server truth — 'confirmed' renders only after the purge RPC
              actually succeeded (see PendingDeletion success branch). */}
          {deletionServerMessageKey(deletion) !== null && (
            <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
              {t(lang, deletionServerMessageKey(deletion)!)}
              {deletion.state === 'confirmed' && deletion.confirmedAt
                ? ` — ${new Date(deletion.confirmedAt).toLocaleString()}`
                : ''}
            </Text>
          )}
          {deletion.state === 'pending' && settings.guardianSharingEnabled && (
            <Text style={[styles.body, { color: colors.textSecondary }]}>
              {t(lang, 'guardianDeletionPendingNote')}
            </Text>
          )}
          {deletion.state === 'pending' && (
            <AccessibleButton
              label={t(lang, 'guardianDeletionRetry')}
              variant="secondary"
              onPress={() => void sharingRef.current?.retryPendingDeletion()}
            />
          )}

          {/* Sharing status — derived from REAL signals only. */}
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t(lang, 'sharingStateLabel')}
          </Text>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
            {t(lang, SHARING_STATE_KEY[sharingState])}
          </Text>
          <Text style={[styles.body, { color: colors.text }]}>
            {t(lang, 'lastUpdateLabel')}:{' '}
            {lastUploadAt
              ? new Date(lastUploadAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')
              : t(lang, 'lastUpdateNever')}
          </Text>
          {queueLen > 0 && (
            <Text style={[styles.body, { color: colors.text }]}>
              {t(lang, 'queuedPointsLabel')}: {queueLen}
            </Text>
          )}

          {/* Background tracking — separate, explained opt-in. */}
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t(lang, 'bgTrackingTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'bgTrackingExpl')}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
            {bgStarted ? t(lang, 'bgTrackingActive') : t(lang, 'bgTrackingInactive')}
          </Text>
          {!!bgMessage && (
            <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
              {bgMessage}
            </Text>
          )}
          {bgStarted ? (
            <AccessibleButton
              label={t(lang, 'bgTrackingDisable')}
              variant="danger"
              onPress={() => void disableBackground()}
            />
          ) : (
            <AccessibleButton label={t(lang, 'bgTrackingEnable')} onPress={() => void enableBackground()} />
          )}
          {bgDenied && (
            <AccessibleButton
              label={t(lang, 'openSystemSettings')}
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          )}

          {/* SOS — stored locally; guardian notification attempted only
              when configured, and the outcome is stated honestly. */}
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t(lang, 'sosTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'sosExpl')}</Text>
          <AccessibleButton
            label={t(lang, 'sosButton')}
            variant="danger"
            onPress={() => {
              void (async () => {
                const outcome = await triggerSos(lang);
                setBgMessage(outcome.message);
              })();
            }}
          />

          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t(lang, 'guardianPairingTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'guardianPairingExpl')}</Text>
          <AccessibleButton label={t(lang, 'guardianCreateCode')} onPress={() => void createCode()} disabled={busy} />
          {code && (
            <View style={styles.codeBox}>
              <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'guardianYourCode')}</Text>
              <Text
                accessibilityLabel={`${t(lang, 'guardianYourCode')}: ${code.code}`}
                style={[styles.codeText, { color: colors.text }]}
              >
                {formatPairingCode(code.code)}
              </Text>
              <QrCodeView value={code.code} accessibilityLabel={`${t(lang, 'guardianYourCode')}: ${code.code}`} />
              <Text style={[styles.body, { color: colors.textSecondary }]}>{t(lang, 'guardianCodeExpires')}</Text>
            </View>
          )}

          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t(lang, 'guardianRequestsTitle')}
          </Text>
          {requests.length === 0 && (
            <Text style={[styles.body, { color: colors.textSecondary }]}>{t(lang, 'guardianNoRequests')}</Text>
          )}
          {requests.map((link) => (
            <View key={link.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.body, { color: colors.text }]}>
                {link.otherPartyName ?? link.guardianId}
              </Text>
              <AccessibleButton label={t(lang, 'guardianApprove')} onPress={() => void actOnRequest(link, true)} />
              <AccessibleButton label={t(lang, 'guardianDeny')} variant="danger" onPress={() => void actOnRequest(link, false)} />
            </View>
          ))}

          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t(lang, 'guardianMyGuardians')}
          </Text>
          {guardians.length === 0 && (
            <Text style={[styles.body, { color: colors.textSecondary }]}>{t(lang, 'guardianNoGuardians')}</Text>
          )}
          {guardians.map((link) => (
            <View key={link.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.body, { color: colors.text }]}>
                {link.otherPartyName ?? link.guardianId} — {t(lang, 'guardianStatusApproved')}
              </Text>
              <AccessibleButton label={t(lang, 'guardianRevoke')} variant="danger" onPress={() => revoke(link)} />
            </View>
          ))}
        </View>
      )}

      {!!message && (
        <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.danger }]}>
          {message}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  heading: { fontSize: typeScale.heading, fontWeight: '700', marginTop: spacing.sm },
  body: { fontSize: typeScale.body, lineHeight: 29 },
  codeText: { fontSize: 40, fontWeight: '800', textAlign: 'center', letterSpacing: 4 },
  codeBox: { gap: spacing.sm, alignItems: 'center' },
  card: { borderWidth: 1.5, borderRadius: 14, padding: spacing.md, gap: 4 },
  row: {
    borderWidth: 1.5,
    borderRadius: 14,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH,
    gap: spacing.sm,
  },
});
