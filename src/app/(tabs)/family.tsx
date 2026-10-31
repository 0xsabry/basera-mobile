/**
 * Family & guardian — pairing, sharing consent, background tracking,
 * SOS. DEPLOYED-contract edition (docs/SUPABASE_INTEGRATION.md):
 *
 * - Pairing: the wearer creates an invite code (Edge Function); the
 *   guardian accepts it (here or in the Guardian PWA) and the link is
 *   PAIRED immediately — the deployed backend has no approval step,
 *   so this screen shows none.
 * - Consent is PER-LINK and wearer-controlled: each guardian row has
 *   its own location + SOS switches, both starting OFF at pairing.
 *   The master switches fan out to all links. Turning the last
 *   location consent off stops collection and deletes the stored
 *   latest location (PendingDeletion confirms server-side).
 * - Status first: My Location, derived sharing status, account,
 *   consent, privacy/deletion, background, SOS, pairing, guardians,
 *   people I guard.
 */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { AccessibleButton } from '../../components/AccessibleButton';
import { MyLocationCard } from '../../components/MyLocationCard';
import { QrCodeView } from '../../components/QrCodeView';
import {
  Banner,
  Card,
  EmptyState,
  ListRow,
  QuietGroup,
  Screen,
  SectionHeader,
  StatusPill,
  type Tone,
} from '../../components/ui';
import {
  GuardianInviteError,
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
import { formatPairingCode, normalizePairingCodeInput } from '../../guardian/pairing';
import { getPushTokenService } from '../../guardian/PushTokenService';
import { deriveSharingState, type SharingState } from '../../guardian/sharingState';
import { getSupabaseClient } from '../../guardian/supabaseClient';
import { getLastSuccessfulUploadAt } from '../../guardian/uploadMeta';
import { triggerSos } from '../../hazards/HazardService';
import { t, type StringKey } from '../../i18n/strings';
import { useSettings } from '../../state/SettingsContext';
import { GLYPHS } from '../../theme/glyphs';
import { radius, spacing } from '../../theme/tokens';

const SHARING_STATE_KEY: Record<SharingState, StringKey> = {
  off: 'sharingStateOff',
  'foreground-only': 'sharingStateForegroundOnly',
  'background-active': 'sharingStateBackgroundActive',
  'permission-denied': 'sharingStatePermissionDenied',
  'gps-unavailable': 'sharingStateGpsUnavailable',
  'offline-queueing': 'sharingStateOfflineQueueing',
  'sync-pending': 'sharingStateSyncPending',
};

const SHARING_STATE_TONE: Record<SharingState, Tone> = {
  off: 'neutral',
  'foreground-only': 'success',
  'background-active': 'success',
  'permission-denied': 'danger',
  'gps-unavailable': 'warning',
  'offline-queueing': 'warning',
  'sync-pending': 'info',
};

export default function GuardianScreen() {
  const { settings, colors, type, update } = useSettings();
  const lang = settings.language;
  const service = getGuardianService();
  const [sharing] = useState(() => getLocationSharingService());
  const [push] = useState(() => getPushTokenService(service));
  const sharingRef = useRef(sharing);
  const [deletion, setDeletion] = useState<DeletionStatus>(() => sharing.deletionStatus);

  const [user, setUser] = useState<GuardianUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [guardians, setGuardians] = useState<GuardianLink[]>([]);
  const [peopleIGuard, setPeopleIGuard] = useState<GuardianLink[]>([]);
  const [sosOn, setSosOn] = useState(false);
  const [acceptCode, setAcceptCode] = useState('');
  const [acceptError, setAcceptError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setNowTick] = useState(0);

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
      const [mine, guarding, consent] = await Promise.all([
        service.listMyGuardians().catch(() => []),
        service.listPeopleIGuard().catch(() => []),
        service
          .getConsent()
          .catch(() => ({ locationSharingEnabled: false, sosSharingEnabled: false })),
      ]);
      setGuardians(mine);
      setPeopleIGuard(guarding);
      setSosOn(consent.sosSharingEnabled);
      // Server consent is the truth for the master switch: if every
      // link's location consent is off (e.g. changed from another
      // device), the local intent follows it down; if a link grants
      // it, local intent follows up so collection can resume.
      if (consent.locationSharingEnabled !== settings.guardianSharingEnabled) {
        await update({
          guardianSharingEnabled: consent.locationSharingEnabled,
          ...(consent.locationSharingEnabled ? {} : { backgroundSharingEnabled: false }),
        });
      }
      // Push-token registration (registration only — delivery is not
      // claimed; never prompts, skips silently without permission).
      void push.registerCurrentToken();
      push.startTokenListener();
    }
    setLoaded(true);
  }, [service, push, settings.guardianSharingEnabled, update]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live link changes (pairing completed elsewhere, consent changed,
  // a guardian unlinked) refresh the lists without a manual reload.
  useEffect(() => {
    if (!user) return;
    const sub = service.subscribeLinks(() => {
      void refresh();
    });
    return () => {
      void sub?.unsubscribe();
    };
  }, [user, service, refresh]);

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

  // Expiry display for a created invite (re-render every 30 s).
  useEffect(() => {
    if (!code?.expiresAt) return;
    const timer = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [code]);

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
        // Explicit consent write (fans out to all my links). Starting
        // collection alone never grants consent in the deployed model.
        await service.setSharingEnabled(true);
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

  const toggleSos = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await service.setSosSharingEnabled(on);
      // Re-read the aggregate: with no guardians the fan-out is a
      // no-op and the switch honestly stays off.
      const consent = await service.getConsent().catch(() => null);
      if (consent) setSosOn(consent.sosSharingEnabled);
    } catch {
      setMessage(t(lang, 'errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const setLinkLocation = async (link: GuardianLink, on: boolean) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      if (on) {
        await service.setLinkConsent(link.id, { locationSharingEnabled: true });
        if (!settings.guardianSharingEnabled) {
          await update({ guardianSharingEnabled: true });
          void sharingRef.current?.start();
        }
      } else {
        const othersOn = guardians.some((g) => g.id !== link.id && g.locationSharingEnabled);
        if (!othersOn) {
          // Last consenting link: full stop — collection halts and the
          // stored latest location is deleted (PendingDeletion path).
          await sharingRef.current?.disableSharing();
          await update({ guardianSharingEnabled: false, backgroundSharingEnabled: false });
        } else {
          await service.setLinkConsent(link.id, { locationSharingEnabled: false });
        }
      }
      await refresh();
    } catch {
      setMessage(t(lang, 'errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const setLinkSos = async (link: GuardianLink, on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await service.setLinkConsent(link.id, { sosSharingEnabled: on });
      await refresh();
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

  const acceptInvite = async () => {
    const normalized = normalizePairingCodeInput(acceptCode);
    if (!normalized) {
      setAcceptError(t(lang, 'guardianInviteErrorInvalidOrExpired'));
      return;
    }
    if (busy) return;
    setBusy(true);
    setAcceptError('');
    setMessage('');
    try {
      await service.redeemPairingCode(normalized);
      setAcceptCode('');
      setMessage(t(lang, 'guardianAcceptSuccess'));
      await refresh();
    } catch (e) {
      if (e instanceof GuardianInviteError) {
        setAcceptError(
          e.kind === 'invalid-or-expired'
            ? t(lang, 'guardianInviteErrorInvalidOrExpired')
            : e.kind === 'already-used'
              ? t(lang, 'guardianInviteErrorUsed')
              : e.kind === 'self-pairing'
                ? t(lang, 'guardianInviteErrorSelf')
                : lang === 'en'
                  ? e.message
                  : t(lang, 'errorGeneric'),
        );
      } else {
        setAcceptError(t(lang, 'errorGeneric'));
      }
    } finally {
      setBusy(false);
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
              if (guardians.length === 1 && link.locationSharingEnabled) {
                // Last guardian WITH location consent: record the
                // persisted deletion obligation FIRST (works offline),
                // which re-drives the revoke + purge and retries until
                // the server confirms — never fire-and-forget.
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

  const unlinkGuarding = (link: GuardianLink) => {
    Alert.alert(t(lang, 'guardianRemoveMyAccess'), t(lang, 'guardianRevokeConfirm'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      {
        text: t(lang, 'confirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await service.revokeLink(link.id);
              await refresh();
            } catch {
              setMessage(t(lang, 'errorGeneric'));
            }
          })();
        },
      },
    ]);
  };

  const signOutFlow = async () => {
    // Token rows first (needs the session), then the sharing purge,
    // then sign out.
    await push.unregister().catch(() => undefined);
    if (settings.guardianSharingEnabled) {
      await sharingRef.current?.disableSharing().catch(() => undefined);
      await update({ guardianSharingEnabled: false, backgroundSharingEnabled: false });
    } else {
      await sharingRef.current?.stopWatching();
    }
    await service.signOut().catch(() => undefined);
    setUser(null);
    setGuardians([]);
    setPeopleIGuard([]);
    await refresh();
  };

  const deleteMyData = () => {
    Alert.alert(t(lang, 'guardianDeleteData'), t(lang, 'guardianDeleteDataConfirm'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      {
        text: t(lang, 'confirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await push.unregister().catch(() => undefined);
            await sharingRef.current?.stopWatching().catch(() => undefined);
            try {
              await service.deleteMyAccountData();
            } catch {
              setMessage(t(lang, 'errorGeneric'));
              return;
            }
            await service.signOut().catch(() => undefined);
            await update({ guardianSharingEnabled: false, backgroundSharingEnabled: false });
            setUser(null);
            setGuardians([]);
            setPeopleIGuard([]);
            // Honest scope: data rows deleted; SOS alert records are
            // retained server-side and the auth account itself needs
            // the service owner (see the confirm copy).
            setMessage(t(lang, 'guardianDataDeleted'));
            await refresh();
          })();
        },
      },
    ]);
  };

  const body = (extra?: object) => [styles.body, { color: colors.text, fontSize: type.body }, extra];
  const bodySecondary = () => [styles.body, { color: colors.textSecondary, fontSize: type.body }];

  if (!service.isConfigured()) {
    return (
      <Screen>
        <SectionHeader title={t(lang, 'guardian')} glyph={GLYPHS.family} />
        <MyLocationCard />
        <EmptyState glyph={GLYPHS.family} title={t(lang, 'guardian')} body={t(lang, 'guardianNotConfigured')} />
      </Screen>
    );
  }

  const codeExpired = code?.expiresAt ? Date.now() > Date.parse(code.expiresAt) : false;

  return (
    <Screen>
      <SectionHeader title={t(lang, 'guardian')} glyph={GLYPHS.family} />
      <Text style={bodySecondary()}>{t(lang, 'guardianLocationNote')}</Text>
      <MyLocationCard />

      {loaded && !user && (
        <Card>
          <Text style={body()}>{t(lang, 'guardianSignInNeeded')}</Text>
          <AccessibleButton label={t(lang, 'guardianOpenSignIn')} onPress={() => router.push('/guardian-auth')} />
        </Card>
      )}

      {user && (
        <>
          {/* Sharing status — derived from REAL signals only. */}
          <SectionHeader title={t(lang, 'sharingStateLabel')} glyph={GLYPHS.updates} />
          <Card>
            <View style={styles.pillRow}>
              <Text accessibilityLiveRegion="polite" style={[body(), styles.flex1]}>
                {t(lang, SHARING_STATE_KEY[sharingState])}
              </Text>
              <StatusPill tone={SHARING_STATE_TONE[sharingState]} label={t(lang, SHARING_STATE_KEY[sharingState])} />
            </View>
            <Text style={body()}>
              {t(lang, 'lastUpdateLabel')}:{' '}
              {lastUploadAt
                ? new Date(lastUploadAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')
                : t(lang, 'lastUpdateNever')}
            </Text>
            {queueLen > 0 && (
              <Text style={body()}>
                {t(lang, 'queuedPointsLabel')}: {queueLen}
              </Text>
            )}
          </Card>

          <Card>
            <Text style={body()}>
              {t(lang, 'guardianSignedInAs')}: {user.email ?? user.id}
            </Text>
            <AccessibleButton
              label={t(lang, 'guardianSignOut')}
              variant="secondary"
              onPress={() => void signOutFlow()}
            />
            <AccessibleButton
              label={t(lang, 'guardianDeleteData')}
              variant="danger"
              onPress={deleteMyData}
            />
          </Card>

          <SectionHeader title={t(lang, 'guardianSharing')} glyph={GLYPHS.location} />
          <Card>
            <Text style={body()}>{t(lang, 'guardianSharingExpl')}</Text>
            <Text style={bodySecondary()}>{t(lang, 'guardianPermissionExpl')}</Text>
            <ListRow
              variant="quiet"
              glyph={GLYPHS.location}
              title={settings.guardianSharingEnabled ? t(lang, 'guardianSharingOn') : t(lang, 'guardianSharingOff')}
              accessibilityLabel={t(lang, 'guardianSharing')}
              right={
                <Switch
                  accessibilityLabel={t(lang, 'guardianSharing')}
                  value={settings.guardianSharingEnabled}
                  onValueChange={(v) => void toggleSharing(v)}
                  trackColor={{ true: colors.primary }}
                />
              }
            />
          </Card>

          <SectionHeader title={t(lang, 'guardianSosSharing')} glyph={GLYPHS.sos} />
          <Card>
            <Text style={body()}>{t(lang, 'guardianSosSharingExpl')}</Text>
            <ListRow
              variant="quiet"
              glyph={GLYPHS.sos}
              title={t(lang, 'guardianSosSharing')}
              accessibilityLabel={t(lang, 'guardianSosSharing')}
              right={
                <Switch
                  accessibilityLabel={t(lang, 'guardianSosSharing')}
                  value={sosOn}
                  onValueChange={(v) => void toggleSos(v)}
                  trackColor={{ true: colors.primary }}
                />
              }
            />
          </Card>

          <SectionHeader title={t(lang, 'guardianPrivacyTitle')} glyph={GLYPHS.privacy} />
          <Card>
            {/* Local truth — always exact, works offline. */}
            <View style={styles.pillRow}>
              <Text style={[body(), styles.flex1]}>
                {settings.guardianSharingEnabled ? t(lang, 'guardianSharingOn') : t(lang, 'guardianLocalOff')}
              </Text>
              <StatusPill
                tone={settings.guardianSharingEnabled ? 'success' : 'neutral'}
                label={settings.guardianSharingEnabled ? t(lang, 'guardianSharingOn') : t(lang, 'guardianLocalOff')}
              />
            </View>
            {/* Server truth — 'confirmed' renders only after the purge
                actually succeeded (see PendingDeletion success branch). */}
            {deletionServerMessageKey(deletion) !== null && (
              <Text accessibilityLiveRegion="polite" style={body()}>
                {t(lang, deletionServerMessageKey(deletion)!)}
                {deletion.state === 'confirmed' && deletion.confirmedAt
                  ? ` — ${new Date(deletion.confirmedAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}`
                  : ''}
              </Text>
            )}
            {deletion.state === 'pending' && settings.guardianSharingEnabled && (
              <Text style={bodySecondary()}>{t(lang, 'guardianDeletionPendingNote')}</Text>
            )}
            {deletion.state === 'pending' && (
              <AccessibleButton
                label={t(lang, 'guardianDeletionRetry')}
                variant="secondary"
                onPress={() => void sharingRef.current?.retryPendingDeletion()}
              />
            )}
          </Card>

          {/* Background tracking — separate, explained opt-in. */}
          <SectionHeader title={t(lang, 'bgTrackingTitle')} glyph={GLYPHS.location} />
          <Card>
            <Text style={body()}>{t(lang, 'bgTrackingExpl')}</Text>
            <View style={styles.pillRow}>
              <Text accessibilityLiveRegion="polite" style={[body(), styles.flex1]}>
                {bgStarted ? t(lang, 'bgTrackingActive') : t(lang, 'bgTrackingInactive')}
              </Text>
              <StatusPill
                tone={bgStarted ? 'success' : 'neutral'}
                label={bgStarted ? t(lang, 'bgTrackingActive') : t(lang, 'bgTrackingInactive')}
              />
            </View>
            {!!bgMessage && (
              <Text accessibilityLiveRegion="polite" style={body()}>
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
          </Card>

          {/* SOS — recorded locally; a server alert is created only
              while SOS sharing is on for at least one guardian, and the
              outcome is stated honestly. */}
          <Banner tone="danger" glyph={GLYPHS.sos} title={t(lang, 'sosTitle')}>
            <Text style={body()}>{t(lang, 'sosExpl')}</Text>
            <AccessibleButton
              label={t(lang, 'sosButton')}
              glyph={GLYPHS.sos}
              variant="danger"
              onPress={() => {
                void (async () => {
                  const outcome = await triggerSos(lang);
                  setBgMessage(outcome.message);
                })();
              }}
            />
          </Banner>

          <SectionHeader title={t(lang, 'guardianPairingTitle')} glyph={GLYPHS.family} />
          <Card>
            <Text style={body()}>{t(lang, 'guardianPairingExpl')}</Text>
            <AccessibleButton label={t(lang, 'guardianCreateCode')} onPress={() => void createCode()} disabled={busy} />
            {code && (
              <View style={styles.codeBox}>
                <Text style={body()}>{t(lang, 'guardianYourCode')}</Text>
                <Text
                  accessibilityLabel={`${t(lang, 'guardianYourCode')}: ${code.code}`}
                  style={[styles.codeText, { color: colors.text }]}
                >
                  {formatPairingCode(code.code)}
                </Text>
                <View style={[styles.qrFrame, { backgroundColor: '#FFFFFF', borderColor: colors.border }]}>
                  <QrCodeView value={code.code} accessibilityLabel={`${t(lang, 'guardianYourCode')}: ${code.code}`} />
                </View>
                <Text style={bodySecondary()}>{t(lang, 'guardianCodeExpires')}</Text>
                {code.expiresAt && !codeExpired && (
                  <Text style={bodySecondary()}>
                    {t(lang, 'guardianInviteExpiresAt')}:{' '}
                    {new Date(code.expiresAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}
                  </Text>
                )}
                {code.expiresAt && codeExpired && (
                  <Text style={[body(), { color: colors.danger }]}>{t(lang, 'guardianInviteExpired')}</Text>
                )}
              </View>
            )}
          </Card>

          <SectionHeader title={t(lang, 'guardianAcceptTitle')} glyph={GLYPHS.family} />
          <Card>
            <Text style={body()}>{t(lang, 'guardianAcceptExpl')}</Text>
            <TextInput
              accessibilityLabel={t(lang, 'guardianInviteCodeLabel')}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder={t(lang, 'guardianInviteCodeLabel')}
              placeholderTextColor={colors.textSecondary}
              value={acceptCode}
              onChangeText={setAcceptCode}
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.surfaceAlt, fontSize: type.body },
              ]}
            />
            {!!acceptError && (
              <Text accessibilityLiveRegion="assertive" style={[body(), { color: colors.danger }]}>
                {acceptError}
              </Text>
            )}
            <AccessibleButton
              label={t(lang, 'guardianAcceptAction')}
              onPress={() => void acceptInvite()}
              disabled={busy || !acceptCode.trim()}
            />
          </Card>

          <SectionHeader title={t(lang, 'guardianMyGuardians')} glyph={GLYPHS.family} />
          {guardians.length === 0 && (
            <Text style={bodySecondary()}>{t(lang, 'guardianNoGuardians')}</Text>
          )}
          {guardians.length > 0 && (
            <QuietGroup>
              {guardians.map((link) => (
                <View key={link.id} style={styles.listBlock}>
                  <View style={styles.pillRow}>
                    <Text style={[body(), styles.flex1]}>{link.otherPartyName ?? link.guardianId}</Text>
                    <StatusPill tone="success" label={t(lang, 'guardianStatusApproved')} />
                  </View>
                  <ListRow
                    variant="quiet"
                    glyph={GLYPHS.location}
                    title={t(lang, 'guardianLinkLocation')}
                    accessibilityLabel={t(lang, 'guardianLinkLocation')}
                    right={
                      <Switch
                        accessibilityLabel={t(lang, 'guardianLinkLocation')}
                        value={link.locationSharingEnabled}
                        onValueChange={(v) => void setLinkLocation(link, v)}
                        trackColor={{ true: colors.primary }}
                      />
                    }
                  />
                  <ListRow
                    variant="quiet"
                    glyph={GLYPHS.sos}
                    title={t(lang, 'guardianLinkSos')}
                    accessibilityLabel={t(lang, 'guardianLinkSos')}
                    right={
                      <Switch
                        accessibilityLabel={t(lang, 'guardianLinkSos')}
                        value={link.sosSharingEnabled}
                        onValueChange={(v) => void setLinkSos(link, v)}
                        trackColor={{ true: colors.primary }}
                      />
                    }
                  />
                  <AccessibleButton label={t(lang, 'guardianRevoke')} variant="danger" onPress={() => revoke(link)} />
                </View>
              ))}
            </QuietGroup>
          )}

          <SectionHeader title={t(lang, 'guardianPeopleIGuard')} glyph={GLYPHS.family} />
          {peopleIGuard.length === 0 && (
            <Text style={bodySecondary()}>{t(lang, 'guardianNoPeopleIGuard')}</Text>
          )}
          {peopleIGuard.length > 0 && (
            <QuietGroup>
              {peopleIGuard.map((link) => (
                <View key={link.id} style={styles.listBlock}>
                  <View style={styles.pillRow}>
                    <Text style={[body(), styles.flex1]}>{link.otherPartyName ?? link.ownerId}</Text>
                    <StatusPill tone="success" label={t(lang, 'guardianStatusApproved')} />
                  </View>
                  <AccessibleButton
                    label={t(lang, 'guardianRemoveMyAccess')}
                    variant="danger"
                    onPress={() => unlinkGuarding(link)}
                  />
                </View>
              ))}
            </QuietGroup>
          )}
        </>
      )}

      {!!message && (
        <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.danger, fontSize: type.body }]}>
          {message}
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
  flex1: { flex: 1 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  codeText: { fontSize: 40, fontWeight: '800', textAlign: 'center', letterSpacing: 4 },
  codeBox: { gap: spacing.sm, alignItems: 'center' },
  listBlock: { gap: spacing.sm, paddingVertical: spacing.xs },
  qrFrame: { padding: spacing.md, borderRadius: 16, borderWidth: 1 },
  input: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 60,
  },
});
