/**
 * Settings — grouped A–G; EVERY control here is real:
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
 *
 * V1.1 redesign: the same controls, presented with the design system —
 * segmented controls (with a ✓ on the selected option, never color
 * alone) instead of stacks of identical full-width buttons, grouped
 * cards, and status pills for permission states.
 */
import Slider from '@react-native-community/slider';
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { curateVoices, type CuratedVoices } from '../../ai/voiceCatalog';
import { AccessibleButton } from '../../components/AccessibleButton';
import {
  Card,
  ListRow,
  QuietGroup,
  Screen,
  SectionHeader,
  SegmentedControl,
  StatusPill,
  type Tone,
} from '../../components/ui';
import { historyStore } from '../../data/HistoryStore';
import { getGuardianService, type GuardianUser } from '../../guardian/GuardianService';
import { getSupabaseClient } from '../../guardian/supabaseClient';
import { t, type StringKey } from '../../i18n/strings';
import { placesStore } from '../../places/PlacesStore';
import { syncPlaces, type PlacesSyncOutcome } from '../../places/placesSync';
import { useSettings } from '../../state/SettingsContext';
import { GLYPHS } from '../../theme/glyphs';
import { MIN_TOUCH, spacing } from '../../theme/tokens';
import { updateService, type UpdateStatus } from '../../update/UpdateService';

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

function permTone(state: PermState): Tone {
  return state === 'granted' ? 'success' : state === 'denied' ? 'danger' : 'neutral';
}

export default function SettingsScreen() {
  const { settings, colors, type, update, switchLanguage } = useSettings();
  const lang = settings.language;
  const configured = getSupabaseClient() !== null;

  const [user, setUser] = useState<GuardianUser | null>(null);
  const [voiceCatalog, setVoiceCatalog] = useState<CuratedVoices | null>(null);
  const [voiceTestFailed, setVoiceTestFailed] = useState(false);
  const [perms, setPerms] = useState<{ camera: PermInfo; mic: PermInfo; locFg: PermInfo; locBg: PermInfo; notif: PermInfo }>({
    camera: UNKNOWN, mic: UNKNOWN, locFg: UNKNOWN, locBg: UNKNOWN, notif: UNKNOWN,
  });
  const [syncMessage, setSyncMessage] = useState('');
  // Reactive update status (launch check runs in the root layout):
  // subscribing keeps this screen's updates row truthful — including
  // the "update ready" state — instead of a one-shot snapshot that
  // went stale the moment the launch download finished.
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(() => updateService.getStatus());
  useEffect(() => updateService.subscribe(() => setUpdateStatus(updateService.getStatus())), []);

  const refresh = useCallback(async () => {
    if (configured) {
      setUser(await getGuardianService().getCurrentUser().catch(() => null));
    }
    try {
      const all = await Speech.getAvailableVoicesAsync();
      setVoiceCatalog(curateVoices(all));
      // Stale-voice guard (Bug 4): a persisted voice identifier the
      // device no longer offers can silence EVERY utterance. If the
      // service's selection is not in the fresh device list, clear it
      // (service + persisted settings) back to the system default.
      const availableIds = new Set(all.map((v) => v.identifier));
      if (!speechService.validateVoiceSelection(availableIds)) {
        void update({ voiceIdentifier: null });
      }
    } catch {
      // Listing itself failed: both language groups render the
      // no-voice guidance instead of the picker silently disappearing.
      setVoiceCatalog({ ar: [], en: [] });
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
  }, [configured, update]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const permRow = (
    glyph: string,
    titleKey: StringKey,
    whyKey: StringKey,
    info: PermInfo,
    onRequest: () => void,
    customAction?: React.ReactNode,
  ) => (
    <View style={styles.permBlock}>
      <View style={styles.permHead}>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body, flex: 1, fontWeight: '700' }]}>
          {t(lang, titleKey)}
        </Text>
        <StatusPill
          tone={permTone(info.state)}
          label={info.state === 'unknown' ? '—' : t(lang, permKey(info.state))}
        />
      </View>
      <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>{t(lang, whyKey)}</Text>
      {customAction ??
        (info.state === 'undetermined' ? (
          <AccessibleButton label={t(lang, 'requestPermission')} variant="secondary" glyph={glyph} onPress={onRequest} />
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

  const onTestVoice = async (identifier: string | null, testLang: 'ar' | 'en') => {
    setVoiceTestFailed(false);
    const ok = await speechService.testSpeak(identifier, testLang);
    if (ok) return;
    setVoiceTestFailed(true);
    // The failed voice was the SELECTED one: per the voiceTestFailed
    // copy, fall back to the system default instead of leaving a
    // voice that cannot speak in place.
    const failedWasSelected =
      identifier === null ? settings.voiceIdentifier === null : settings.voiceIdentifier === identifier;
    if (failedWasSelected && settings.voiceIdentifier !== null) {
      speechService.setVoiceIdentifier(null);
      void update({ voiceIdentifier: null });
    }
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

  const switchRow = (
    glyph: string,
    label: string,
    value: boolean,
    onValueChange: (v: boolean) => void,
    hint?: string,
  ) => (
    <ListRow
      variant="quiet"
      glyph={glyph}
      title={label}
      subtitle={hint}
      accessibilityLabel={label}
      accessibilityHint={hint}
      right={
        <Switch
          accessibilityLabel={label}
          value={value}
          onValueChange={onValueChange}
          trackColor={{ true: colors.primary }}
        />
      }
    />
  );

  return (
    <Screen>
      {/* ---------- A) Account & Family ---------- */}
      <SectionHeader title={t(lang, 'accountTitle')} glyph={GLYPHS.account} />
      <Card>
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
        <ListRow
          variant="quiet"
          glyph={GLYPHS.family}
          title={t(lang, 'familyManage')}
          subtitle={`${t(lang, 'sharingConsentLabel')}: ${settings.guardianSharingEnabled ? t(lang, 'sharingStateOn') : t(lang, 'sharingStateOff')}`}
          onPress={() => router.push('/(tabs)/family')}
        />
      </Card>

      {/* ---------- B) Language & Appearance ---------- */}
      <SectionHeader title={t(lang, 'language')} glyph={GLYPHS.language} />
      <QuietGroup>
        <SegmentedControl
          accessibilityLabel={t(lang, 'language')}
          value={lang}
          onChange={(v) => void switchLanguage(v)}
          options={[
            { value: 'ar' as const, label: 'العربية' },
            { value: 'en' as const, label: 'English' },
          ]}
        />
      </QuietGroup>
      <SectionHeader title={t(lang, 'theme')} glyph={GLYPHS.glasses} />
      <QuietGroup>
        <SegmentedControl
          accessibilityLabel={t(lang, 'theme')}
          value={settings.theme}
          onChange={(v) => void update({ theme: v })}
          options={[
            { value: 'light' as const, label: t(lang, 'themeLight') },
            { value: 'dark' as const, label: t(lang, 'themeDark') },
            { value: 'system' as const, label: t(lang, 'themeSystem') },
          ]}
        />
        {switchRow(GLYPHS.check, t(lang, 'highContrast'), settings.highContrast, (v) => void update({ highContrast: v }))}
        <View style={styles.fieldBlock}>
          <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>{t(lang, 'textSize')}</Text>
          <SegmentedControl
            accessibilityLabel={t(lang, 'textSize')}
            value={String(settings.textScale)}
            onChange={(v) => void update({ textScale: Number(v) as 1 | 1.15 | 1.3 })}
            options={[
              { value: '1', label: t(lang, 'textSizeNormal') },
              { value: '1.15', label: t(lang, 'textSizeLarge') },
              { value: '1.3', label: t(lang, 'textSizeXL') },
            ]}
          />
        </View>
        {switchRow(
          GLYPHS.stop,
          t(lang, 'reducedMotion'),
          settings.reducedMotion,
          (v) => void update({ reducedMotion: v }),
          t(lang, 'reducedMotionExpl'),
        )}
      </QuietGroup>

      {/* ---------- C) Voice & Accessibility ---------- */}
      <SectionHeader title={t(lang, 'voicePickerTitle')} glyph={GLYPHS.voice} />
      <QuietGroup>
        {switchRow(
          GLYPHS.speak,
          t(lang, 'speechTitle'),
          settings.speechEnabled,
          (v) => void update({ speechEnabled: v }),
          t(lang, 'speechExpl'),
        )}
        <View style={styles.fieldBlock}>
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
        </View>
        {voiceCatalog !== null && (
          <View style={styles.fieldBlock}>
            <ListRow
              variant="quiet"
              title={t(lang, 'voiceDefault')}
              accessibilityLabel={t(lang, 'voiceDefault')}
              onPress={() => void update({ voiceIdentifier: null })}
              right={
                settings.voiceIdentifier === null ? (
                  <Text style={{ color: colors.primary, fontSize: type.body, fontWeight: '800' }}>{GLYPHS.check}</Text>
                ) : undefined
              }
            />
            <AccessibleButton
              label={t(lang, 'voiceTest')}
              variant="secondary"
              glyph={GLYPHS.speak}
              onPress={() => void onTestVoice(null, lang)}
            />
            {(['ar', 'en'] as const).map((groupLang) => {
              const group = voiceCatalog[groupLang];
              const groupTitle = t(lang, groupLang === 'ar' ? 'voiceAvailableAr' : 'voiceAvailableEn');
              return (
                <View key={groupLang} style={styles.fieldBlock}>
                  <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
                    {groupTitle}
                  </Text>
                  {group.length === 0 ? (
                    <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
                      {t(lang, 'voiceNoneAvailable')}
                    </Text>
                  ) : (
                    group.map((v) => {
                      const label = v.engineHint ? `${groupTitle} · ${v.engineHint}` : groupTitle;
                      const selected = settings.voiceIdentifier === v.identifier;
                      return (
                        <View key={v.identifier} style={styles.fieldBlock}>
                          <ListRow
                            variant="quiet"
                            title={label}
                            accessibilityLabel={label}
                            onPress={() => void update({ voiceIdentifier: v.identifier })}
                            right={
                              selected ? (
                                <Text style={{ color: colors.primary, fontSize: type.body, fontWeight: '800' }}>
                                  {GLYPHS.check}
                                </Text>
                              ) : undefined
                            }
                          />
                          <AccessibleButton
                            label={t(lang, 'voiceTest')}
                            variant="secondary"
                            glyph={GLYPHS.speak}
                            onPress={() => void onTestVoice(v.identifier, groupLang)}
                          />
                        </View>
                      );
                    })
                  )}
                </View>
              );
            })}
            {!!voiceTestFailed && (
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.body, { color: colors.danger, fontSize: type.body }]}
              >
                {t(lang, 'voiceTestFailed')}
              </Text>
            )}
          </View>
        )}
        {switchRow(GLYPHS.notifications, t(lang, 'announcements'), settings.announcements, (v) =>
          void update({ announcements: v }),
        )}
        {switchRow(
          GLYPHS.alerts,
          t(lang, 'hapticsTitle'),
          settings.hapticsEnabled,
          (v) => void update({ hapticsEnabled: v }),
          t(lang, 'hapticsExpl'),
        )}
        <View style={styles.fieldBlock}>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'repeatExpl')}</Text>
          <AccessibleButton label={t(lang, 'repeat')} glyph={GLYPHS.repeat} variant="secondary" onPress={() => void speechService.repeatLast()} />
        </View>
      </QuietGroup>

      {/* ---------- D) Privacy & Permissions ---------- */}
      <SectionHeader title={t(lang, 'permissionsTitle')} glyph={GLYPHS.shield} />
      <QuietGroup>
        {permRow(GLYPHS.camera, 'cameraPermission', 'permWhyCamera', perms.camera, () => {
          void Camera.requestCameraPermissionsAsync().then(refresh);
        })}
        {permRow(GLYPHS.mic, 'micPermission', 'permWhyMic', perms.mic, () => {
          void Camera.requestMicrophonePermissionsAsync().then(refresh);
        })}
        {permRow(GLYPHS.location, 'locationPermission', 'permWhyLocationFg', perms.locFg, () => {
          void Location.requestForegroundPermissionsAsync().then(refresh);
        })}
        {permRow(
          GLYPHS.location,
          'locationPermissionBg',
          'permWhyLocationBg',
          perms.locBg,
          () => undefined,
          perms.locBg.state !== 'granted' ? (
            <AccessibleButton label={t(lang, 'manageInFamily')} variant="secondary" onPress={() => router.push('/(tabs)/family')} />
          ) : undefined,
        )}
        {permRow(GLYPHS.notifications, 'notifPermission', 'permWhyNotifications', perms.notif, () => {
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
      </QuietGroup>
      <SectionHeader title={t(lang, 'privacy')} glyph={GLYPHS.privacy} />
      <QuietGroup>
        <View style={styles.fieldBlock}>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'privacyBody')}</Text>
          <AccessibleButton label={t(lang, 'clearAll')} variant="danger" onPress={confirmClearHistory} />
        </View>
      </QuietGroup>

      {/* ---------- E) Places ---------- */}
      <SectionHeader title={t(lang, 'placesProximityTitle')} glyph={GLYPHS.places} />
      <QuietGroup>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'placesProximityExpl')}</Text>
        <View style={styles.fieldBlock}>
          <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
            {t(lang, 'placesRadiusLabel')}
          </Text>
          <SegmentedControl
            accessibilityLabel={t(lang, 'placesRadiusLabel')}
            value={String(settings.proximityRadiusM)}
            onChange={(v) => void update({ proximityRadiusM: Number(v) })}
            options={RADII.map((r) => ({ value: String(r), label: `${r} m` }))}
          />
        </View>
        <ListRow
          variant="quiet"
          glyph={GLYPHS.places}
          title={t(lang, 'places')}
          subtitle={t(lang, 'placesHint')}
          onPress={() => router.push('/places')}
        />
        {switchRow(
          GLYPHS.updates,
          t(lang, 'placesSyncTitle'),
          settings.placesSyncEnabled,
          (v) => void update({ placesSyncEnabled: v }),
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
      </QuietGroup>

      {/* ---------- F) Updates ---------- */}
      <SectionHeader title={t(lang, 'updates')} glyph={GLYPHS.updates} />
      <QuietGroup>
        <ListRow
          variant="quiet"
          glyph={GLYPHS.updates}
          title={t(lang, 'updates')}
          subtitle={`${t(lang, 'runtimeLabel')}: ${updateStatus.runtimeVersion ?? '—'} · ${t(lang, 'channelLabel')}: ${updateStatus.channel ?? '—'}${updateStatus.phase === 'ready' ? ` · ${t(lang, 'updateReady')}` : ''}`}
          accessibilityHint={t(lang, 'updatesHint')}
          onPress={() => router.push('/updates')}
        />
      </QuietGroup>

      {/* ---------- G) About ---------- */}
      <SectionHeader title={t(lang, 'about')} glyph={GLYPHS.info} />
      <Card>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {t(lang, 'appName')} — {t(lang, 'versionLabel')}: {updateStatus.runtimeVersion ?? '1.1.0'} · me.auramarketing.basera
        </Text>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'aboutModels')}</Text>
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'hardwareStatus')}</Text>
        <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>{t(lang, 'onboardingGlassesNote')}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
  label: { fontWeight: '600' },
  permHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  permBlock: { gap: spacing.sm, paddingVertical: spacing.xs },
  fieldBlock: { gap: spacing.sm },
});
