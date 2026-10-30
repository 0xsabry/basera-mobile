/**
 * Settings — rebuilt in groups; EVERY control here is real:
 * A) Account & Family (real auth state when Supabase is configured,
 *    honest unconfigured note otherwise), B) Language & Appearance
 *    (language/theme/high-contrast/text-scale/reduced-motion — the
 *    text scale flows through the shared typography), C) Voice &
 *    Accessibility (speech gate, rate, device voice picker, haptics,
 *    announcements), D) Privacy & Permissions (statuses read from the
 *    actual OS modules, why-text, request/settings recovery),
 *    E) Places (proximity radius, opt-in sync), F) Updates summary,
 *    G) About (versions from the update service, model licences).
 * Anything the platform cannot do is omitted, not faked — e.g. there
 * is deliberately NO "follow device language" option (it would need
 * a native localization module; noted in docs as a future option).
 */
import Slider from '@react-native-community/slider';
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { AccessibleButton } from '../../components/AccessibleButton';
import { historyStore } from '../../data/HistoryStore';
import { getGuardianService, type GuardianUser } from '../../guardian/GuardianService';
import { getSupabaseClient } from '../../guardian/supabaseClient';
import { t, type StringKey } from '../../i18n/strings';
import { placesStore } from '../../places/PlacesStore';
import { syncPlaces, type PlacesSyncOutcome } from '../../places/placesSync';
import { useSettings } from '../../state/SettingsContext';
import { MIN_TOUCH, radius, spacing } from '../../theme/tokens';
import { updateService } from '../../update/UpdateService';

type PermState = 'granted' | 'denied' | 'undetermined' | 'unknown';
interface PermInfo {
  state: PermState;
  canAskAgain: boolean;
}

const UNKNOWN: PermInfo = { state: 'unknown', canAskAgain: false };
const RADII = [50, 100, 150, 200, 500];

function permKey(state: PermState): StringKey {
  return state === 'granted' ? 'permGranted' : state === 'denied' ? 'permDenied' : 'permUndetermined';
}

export default function SettingsScreen() {
  const { settings, colors, type, update } = useSettings();
  const lang = settings.language;
  const configured = getSupabaseClient() !== null;

  const [user, setUser] = useState<GuardianUser | null>(null);
  const [voices, setVoices] = useState<Speech.Voice[] | null>(null);
  const [perms, setPerms] = useState<{ camera: PermInfo; mic: PermInfo; locFg: PermInfo; locBg: PermInfo; notif: PermInfo }>({
    camera: UNKNOWN, mic: UNKNOWN, locFg: UNKNOWN, locBg: UNKNOWN, notif: UNKNOWN,
  });
  const [syncMessage, setSyncMessage] = useState('');
  const updateStatus = updateService.getStatus();

  const refresh = useCallback(async () => {
    if (configured) {
      setUser(await getGuardianService().getCurrentUser().catch(() => null));
    }
    try {
      const all = await Speech.getAvailableVoicesAsync();
      setVoices(all.filter((v) => v.language?.toLowerCase().startsWith('ar') || v.language?.toLowerCase().startsWith('en')));
    } catch {
      setVoices([]);
    }
    const map = (r: { granted: boolean; canAskAgain?: boolean; status?: string }): PermInfo => ({
      state: r.granted ? 'granted' : r.status === 'denied' || r.canAskAgain === false ? 'denied' : 'undetermined',
      canAskAgain: !!r.canAskAgain,
    });
    try {
      const [cam, mic, fg, bg] = await Promise.all([
        Camera.getCameraPermissionsAsync(),
        Camera.getMicrophonePermissionsAsync(),
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
      ]);
      let notif: PermInfo = UNKNOWN;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Notifications = require('expo-notifications');
        notif = map(await Notifications.getPermissionsAsync());
      } catch {
        /* leave unknown */
      }
      setPerms({ camera: map(cam), mic: map(mic), locFg: map(fg), locBg: map(bg), notif });
    } catch {
      /* keep unknown states — the UI shows them honestly */
    }
  }, [configured]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const row = (label: string, control: React.ReactNode, hint?: string) => (
    <View
      style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
      accessible
      accessibilityLabel={label}
      accessibilityHint={hint}
    >
      <Text style={[styles.body, { color: colors.text, fontSize: type.body, flex: 1 }]}>{label}</Text>
      {control}
    </View>
  );

  const heading = (key: StringKey) => (
    <Text accessibilityRole="header" style={[styles.heading, { color: colors.text, fontSize: type.heading }]}>
      {t(lang, key)}
    </Text>
  );

  const permRow = (titleKey: StringKey, whyKey: StringKey, info: PermInfo, onRequest: () => void, customAction?: React.ReactNode) => (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
        {t(lang, titleKey)}: {info.state === 'unknown' ? '—' : t(lang, permKey(info.state))}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>{t(lang, whyKey)}</Text>
      {customAction ??
        (info.state === 'undetermined' ? (
          <AccessibleButton label={t(lang, 'requestPermission')} variant="secondary" onPress={onRequest} />
        ) : info.state === 'denied' ? (
          <AccessibleButton
            label={t(lang, 'openSystemSettings')}
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        ) : null)}
    </View>
  );

  const doSync = async () => {
    const outcome: PlacesSyncOutcome = await syncPlaces(placesStore);
    setSyncMessage(
      outcome === 'synced'
        ? t(lang, 'placesSyncDone')
        : outcome === 'unconfigured'
          ? t(lang, 'guardianNotConfigured')
          : t(lang, 'placesSyncFailed'),
    );
  };

  const confirmClearHistory = () => {
    Alert.alert(t(lang, 'clearAll'), t(lang, 'clearConfirm'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      {
        text: t(lang, 'confirm'),
        style: 'destructive',
        onPress: async () => {
          await historyStore.clear();
        },
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      {/* ---------- A) Account & Family ---------- */}
      {heading('accountTitle')}
      {!configured ? (
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'guardianNotConfigured')}</Text>
      ) : user ? (
        <>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {t(lang, 'signedInAs')}: {user.email ?? user.id}
          </Text>
          <AccessibleButton
            label={t(lang, 'guardianSignOut')}
            variant="secondary"
            onPress={() => {
              void (async () => {
                await getGuardianService().signOut().catch(() => undefined);
                setUser(null);
              })();
            }}
          />
        </>
      ) : (
        <>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'notSignedIn')}</Text>
          <AccessibleButton label={t(lang, 'guardianOpenSignIn')} onPress={() => router.push('/guardian-auth')} />
        </>
      )}
      <AccessibleButton
        label={t(lang, 'familyManage')}
        variant="secondary"
        onPress={() => router.push('/(tabs)/family')}
      />
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
        {t(lang, 'sharingConsentLabel')}:{' '}
        {settings.guardianSharingEnabled ? t(lang, 'sharingStateOn') : t(lang, 'sharingStateOff')}
      </Text>

      {/* ---------- B) Language & Appearance ---------- */}
      {heading('language')}
      <AccessibleButton label="العربية" onPress={() => update({ language: 'ar' })} variant={lang === 'ar' ? 'primary' : 'secondary'} />
      <AccessibleButton label="English" onPress={() => update({ language: 'en' })} variant={lang === 'en' ? 'primary' : 'secondary'} />
      {heading('theme')}
      <AccessibleButton label={t(lang, 'themeLight')} onPress={() => update({ theme: 'light' })} variant={settings.theme === 'light' ? 'primary' : 'secondary'} />
      <AccessibleButton label={t(lang, 'themeDark')} onPress={() => update({ theme: 'dark' })} variant={settings.theme === 'dark' ? 'primary' : 'secondary'} />
      <AccessibleButton label={t(lang, 'themeSystem')} onPress={() => update({ theme: 'system' })} variant={settings.theme === 'system' ? 'primary' : 'secondary'} />
      {row(
        t(lang, 'highContrast'),
        <Switch accessibilityLabel={t(lang, 'highContrast')} value={settings.highContrast} onValueChange={(v) => update({ highContrast: v })} trackColor={{ true: colors.primary }} />,
      )}
      <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>{t(lang, 'textSize')}</Text>
      <AccessibleButton label={t(lang, 'textSizeNormal')} onPress={() => update({ textScale: 1 })} variant={settings.textScale === 1 ? 'primary' : 'secondary'} />
      <AccessibleButton label={t(lang, 'textSizeLarge')} onPress={() => update({ textScale: 1.15 })} variant={settings.textScale === 1.15 ? 'primary' : 'secondary'} />
      <AccessibleButton label={t(lang, 'textSizeXL')} onPress={() => update({ textScale: 1.3 })} variant={settings.textScale === 1.3 ? 'primary' : 'secondary'} />
      {row(
        t(lang, 'reducedMotion'),
        <Switch accessibilityLabel={t(lang, 'reducedMotion')} value={settings.reducedMotion} onValueChange={(v) => update({ reducedMotion: v })} trackColor={{ true: colors.primary }} />,
        t(lang, 'reducedMotionExpl'),
      )}

      {/* ---------- C) Voice & Accessibility ---------- */}
      {heading('voicePickerTitle')}
      {row(
        t(lang, 'speechTitle'),
        <Switch accessibilityLabel={t(lang, 'speechTitle')} value={settings.speechEnabled} onValueChange={(v) => update({ speechEnabled: v })} trackColor={{ true: colors.primary }} />,
        t(lang, 'speechExpl'),
      )}
      <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
        {t(lang, 'speechRate')}: {settings.speechRate.toFixed(2)}x
      </Text>
      <Slider
        accessibilityLabel={t(lang, 'speechRate')}
        minimumValue={0.5}
        maximumValue={2}
        step={0.25}
        value={settings.speechRate}
        minimumTrackTintColor={colors.primary}
        thumbTintColor={colors.primary}
        style={{ minHeight: MIN_TOUCH }}
        onValueChange={(v) => {
          speechService.setRate(v);
          void update({ speechRate: v });
        }}
      />
      {voices !== null && voices.length > 0 && (
        <>
          <AccessibleButton
            label={t(lang, 'voiceDefault')}
            variant={settings.voiceIdentifier === null ? 'primary' : 'secondary'}
            onPress={() => update({ voiceIdentifier: null })}
          />
          {voices.map((v) => (
            <AccessibleButton
              key={v.identifier}
              label={`${v.name} — ${v.language}`}
              variant={settings.voiceIdentifier === v.identifier ? 'primary' : 'secondary'}
              onPress={() => update({ voiceIdentifier: v.identifier })}
            />
          ))}
        </>
      )}
      {row(
        t(lang, 'announcements'),
        <Switch accessibilityLabel={t(lang, 'announcements')} value={settings.announcements} onValueChange={(v) => update({ announcements: v })} trackColor={{ true: colors.primary }} />,
      )}
      {row(
        t(lang, 'hapticsTitle'),
        <Switch accessibilityLabel={t(lang, 'hapticsTitle')} value={settings.hapticsEnabled} onValueChange={(v) => update({ hapticsEnabled: v })} trackColor={{ true: colors.primary }} />,
        t(lang, 'hapticsExpl'),
      )}
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'repeatExpl')}</Text>
      <AccessibleButton label={t(lang, 'repeat')} variant="secondary" onPress={() => void speechService.repeatLast()} />

      {/* ---------- D) Privacy & Permissions ---------- */}
      {heading('permissionsTitle')}
      {permRow('cameraPermission', 'permWhyCamera', perms.camera, () => {
        void Camera.requestCameraPermissionsAsync().then(refresh);
      })}
      {permRow('micPermission', 'permWhyMic', perms.mic, () => {
        void Camera.requestMicrophonePermissionsAsync().then(refresh);
      })}
      {permRow('locationPermission', 'permWhyLocationFg', perms.locFg, () => {
        void Location.requestForegroundPermissionsAsync().then(refresh);
      })}
      {permRow(
        'locationPermissionBg',
        'permWhyLocationBg',
        perms.locBg,
        () => undefined,
        perms.locBg.state !== 'granted' ? (
          <AccessibleButton label={t(lang, 'manageInFamily')} variant="secondary" onPress={() => router.push('/(tabs)/family')} />
        ) : undefined,
      )}
      {permRow('notifPermission', 'permWhyNotifications', perms.notif, () => {
        void (async () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const Notifications = require('expo-notifications');
            await Notifications.requestPermissionsAsync();
          } catch {
            /* module unavailable in this build */
          }
          await refresh();
        })();
      })}
      {heading('privacy')}
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'privacyBody')}</Text>
      <AccessibleButton label={t(lang, 'clearAll')} variant="danger" onPress={confirmClearHistory} />

      {/* ---------- E) Places ---------- */}
      {heading('placesProximityTitle')}
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'placesProximityExpl')}</Text>
      <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
        {t(lang, 'placesRadiusLabel')}
      </Text>
      {RADII.map((r) => (
        <AccessibleButton
          key={r}
          label={`${r} m`}
          variant={settings.proximityRadiusM === r ? 'primary' : 'secondary'}
          onPress={() => update({ proximityRadiusM: r })}
        />
      ))}
      <AccessibleButton label={t(lang, 'places')} variant="secondary" onPress={() => router.push('/places')} />
      {row(
        t(lang, 'placesSyncTitle'),
        <Switch accessibilityLabel={t(lang, 'placesSyncTitle')} value={settings.placesSyncEnabled} onValueChange={(v) => update({ placesSyncEnabled: v })} trackColor={{ true: colors.primary }} />,
        t(lang, 'placesSyncExpl'),
      )}
      {settings.placesSyncEnabled && (
        <AccessibleButton label={t(lang, 'placesSyncNow')} variant="secondary" onPress={() => void doSync()} />
      )}
      {!!syncMessage && (
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {syncMessage}
        </Text>
      )}

      {/* ---------- F) Updates ---------- */}
      {heading('updates')}
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
        {t(lang, 'runtimeLabel')}: {updateStatus.runtimeVersion ?? '—'} · {t(lang, 'channelLabel')}:{' '}
        {updateStatus.channel ?? '—'}
      </Text>
      <AccessibleButton label={t(lang, 'updates')} hint={t(lang, 'updatesHint')} variant="secondary" onPress={() => router.push('/updates')} />

      {/* ---------- G) About ---------- */}
      {heading('about')}
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
        {t(lang, 'appName')} — {t(lang, 'versionLabel')}: {updateStatus.runtimeVersion ?? '1.1.0'} · me.auramarketing.basera
      </Text>
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'aboutModels')}</Text>
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'hardwareStatus')}</Text>
      <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>{t(lang, 'onboardingGlassesNote')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  heading: { fontWeight: '700', marginTop: spacing.md },
  body: { lineHeight: 29 },
  label: { fontWeight: '600' },
  row: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH,
    gap: spacing.sm,
  },
  card: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, gap: 6 },
});
