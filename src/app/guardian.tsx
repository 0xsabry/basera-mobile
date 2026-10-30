import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { QrCodeView } from '../components/QrCodeView';
import {
  getGuardianService,
  type GuardianLink,
  type GuardianUser,
  type PairingCode,
} from '../guardian/GuardianService';
import { LocationSharingService } from '../guardian/LocationSharingService';
import { formatPairingCode } from '../guardian/pairing';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { MIN_TOUCH, spacing, typeScale } from '../theme/tokens';

export default function GuardianScreen() {
  const { settings, colors, update } = useSettings();
  const lang = settings.language;
  const service = getGuardianService();
  const sharingRef = useRef<LocationSharingService | null>(null);
  if (!sharingRef.current) sharingRef.current = new LocationSharingService(service);

  const [user, setUser] = useState<GuardianUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [requests, setRequests] = useState<GuardianLink[]>([]);
  const [guardians, setGuardians] = useState<GuardianLink[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

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

  // If consent is on and we are signed in, (re)start foreground sharing
  // when this screen opens; collection always pauses off-screen (the
  // service itself also stops on app background).
  useEffect(() => {
    if (user && settings.guardianSharingEnabled) {
      void sharingRef.current?.start();
    }
  }, [user, settings.guardianSharingEnabled]);

  useEffect(() => {
    return () => {
      void sharingRef.current?.stopWatching();
    };
  }, []);

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
        await update({ guardianSharingEnabled: false });
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
