/**
 * "My location" card — the phone's own current fix, on the Family
 * screen. Fully LOCAL: it works with the guardian backend completely
 * unconfigured, and it never fabricates a fix — every state shown is
 * derived from real OS reads (services, permission) and the real
 * one-shot fix from places/currentFix.
 *
 * Prompt discipline: on mount / screen focus it NEVER prompts — it
 * reads permission and, only if already granted, takes a fix via
 * getFixIfPermitted(). The system prompt may appear only from the
 * explicit "Update location" button (getCurrentFix(true)).
 * Coordinates are never logged anywhere.
 *
 * When a fix is shown, its human address is resolved via
 * places/geocode (Nominatim → device geocoder) for the active
 * language; when no source can name the place, the coordinates are
 * shown on their own clearly-labeled line — never as a fake address.
 */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import {
  accuracyQuality,
  deriveMyLocationState,
  formatFixAge,
  type PermissionSignal,
} from '../guardian/locationStatus';
import { getSupabaseClient } from '../guardian/supabaseClient';
import { t } from '../i18n/strings';
import { getCurrentFix, getFixIfPermitted, type GeoFix } from '../places/currentFix';
import { defaultGeocoder, type ResolvedAddress } from '../places/geocode';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { spacing } from '../theme/tokens';
import { AccessibleButton } from './AccessibleButton';
import { LocationMapPreview } from './LocationMapPreview';
import { Card, SectionHeader, StatusPill } from './ui';

interface LocationModuleLike {
  hasServicesEnabledAsync(): Promise<boolean>;
  getForegroundPermissionsAsync(): Promise<{ granted: boolean; status?: string }>;
}

function loadLocation(): LocationModuleLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-location') as LocationModuleLike;
}

async function readServicesEnabled(): Promise<boolean | null> {
  try {
    return await loadLocation().hasServicesEnabledAsync();
  } catch {
    return null;
  }
}

async function readPermission(): Promise<PermissionSignal> {
  try {
    const res = await loadLocation().getForegroundPermissionsAsync();
    if (res.granted) return 'granted';
    return res.status === 'denied' ? 'denied' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function MyLocationCard() {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;

  const [fix, setFix] = useState<GeoFix | null>(null);
  const [locating, setLocating] = useState(false);
  const [permission, setPermission] = useState<PermissionSignal>('unknown');
  const [servicesEnabled, setServicesEnabled] = useState<boolean | null>(null);
  /** Render clock: refreshed whenever signals are (re)read, so fix age
   *  is computed from state — never from Date.now() during render. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  const inFlight = useRef(false);

  /** Reverse-geocoded address for the shown fix, in the language it
   *  was resolved for (a result in the other language is not shown). */
  const [resolved, setResolved] = useState<{ res: ResolvedAddress; lang: typeof lang } | null>(null);
  const [resolving, setResolving] = useState(false);
  const fixAt = fix?.at ?? null;

  // Resolve the shown fix's address for the active language. Keyed by
  // fix.at + lang only — never on every render. The forFixAt/stale
  // guard ensures a slow older response never overwrites the address
  // of a newer fix. No permission prompt can come from this path:
  // geocoding an already-obtained fix needs no permission.
  useEffect(() => {
    if (!fix || fixAt === null) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    setResolving(true);
    defaultGeocoder
      .resolveAddress(fix, lang)
      .then((res) => {
        if (cancelled) return;
        setResolving(false);
        if (!res.stale && res.forFixAt === fixAt) setResolved({ res, lang });
      })
      .catch(() => {
        if (!cancelled) setResolving(false);
      });
    return () => {
      cancelled = true;
    };
    // fix is captured through fixAt: a new fix always has a new `at`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixAt, lang]);

  /** Silent load: reads signals and takes a fix ONLY if permitted. */
  const loadSilent = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLocating(true);
    try {
      const [services, perm] = await Promise.all([readServicesEnabled(), readPermission()]);
      setServicesEnabled(services);
      setPermission(perm);
      if (services !== false && perm === 'granted') {
        const result = await getFixIfPermitted();
        if (result.fix) {
          setFix(result.fix);
          setNowMs(Date.now());
        } else if (result.error === 'permission') setPermission('denied');
      }
    } finally {
      inFlight.current = false;
      setLocating(false);
    }
  }, []);

  // Runs on mount and on every focus return — and never prompts.
  useFocusEffect(
    useCallback(() => {
      void loadSilent();
    }, [loadSilent]),
  );

  /** Explicit user action: this is the only path that may prompt. */
  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLocating(true);
    try {
      const services = await readServicesEnabled();
      setServicesEnabled(services);
      if (services === false) return;
      const result = await getCurrentFix(true);
      if (result.fix) {
        setFix(result.fix);
        setNowMs(Date.now());
        setPermission('granted');
      } else if (result.error === 'permission') {
        setPermission('denied');
      } else {
        // 'unavailable': services off (re-read tells) or no fix yet.
        const servicesNow = await readServicesEnabled();
        setServicesEnabled(servicesNow);
        // Services still on and no fix kept: state stays 'no-fix'
        // (a previously obtained fix, if any, is kept as last-known).
      }
    } catch {
      const servicesNow = await readServicesEnabled().catch(() => null);
      setServicesEnabled(servicesNow);
    } finally {
      inFlight.current = false;
      setLocating(false);
    }
  };

  const state = deriveMyLocationState({ locating, permission, servicesEnabled, fix, now: nowMs });
  const ageMs = fix ? Math.max(0, nowMs - fix.at) : 0;
  const quality = accuracyQuality(fix?.accuracyM ?? null);
  const accuracyText =
    fix && fix.accuracyM !== null
      ? `${t(lang, 'placesAccuracy')}: ${Math.round(fix.accuracyM)} ${lang === 'ar' ? 'م' : 'm'}`
      : null;
  const stateLabel =
    state === 'fresh'
      ? t(lang, 'locationCurrent')
      : state === 'stale'
        ? t(lang, 'locationStaleLabel')
        : null;
  const summaryLabel = fix
    ? [t(lang, 'myLocation'), stateLabel, accuracyText].filter(Boolean).join('. ')
    : t(lang, 'myLocation');
  /** Address applied only when it belongs to the fix on screen AND
   *  was resolved in the active language. */
  const shownAddress =
    resolved && fix && resolved.lang === lang && resolved.res.forFixAt === fix.at
      ? resolved.res
      : null;

  const configured = getSupabaseClient() !== null;
  const sharingLabel = !configured
    ? t(lang, 'sharingStateUnconfigured')
    : settings.guardianSharingEnabled
      ? t(lang, 'sharingStateOn')
      : t(lang, 'sharingStateOff');
  const sharingTone = !configured ? 'warning' : settings.guardianSharingEnabled ? 'success' : 'neutral';

  const body = { color: colors.text, fontSize: type.body, lineHeight: type.body * 1.45 };
  const bodySecondary = { color: colors.textSecondary, fontSize: type.body, lineHeight: type.body * 1.45 };

  return (
    <>
      <SectionHeader title={t(lang, 'myLocation')} glyph={GLYPHS.location} />
      <Card>
        <Text style={bodySecondary}>{t(lang, 'myLocationHint')}</Text>

        {state === 'locating' && (
          <Text accessibilityLiveRegion="polite" style={body}>
            {t(lang, 'locatingNow')}
          </Text>
        )}

        {state === 'permission-denied' && (
          <>
            <Text accessibilityLiveRegion="polite" style={body}>
              {t(lang, 'locationPermissionNeeded')}
            </Text>
            <AccessibleButton
              label={t(lang, 'openSystemSettings')}
              variant="secondary"
              onPress={() => void Linking.openSettings()}
            />
          </>
        )}

        {state === 'services-off' && (
          <Text accessibilityLiveRegion="polite" style={body}>
            {t(lang, 'locationServicesOff')}
          </Text>
        )}

        {state === 'no-fix' && (
          <Text accessibilityLiveRegion="polite" style={body}>
            {t(lang, 'locationNone')}
          </Text>
        )}

        {(state === 'fresh' || state === 'stale') && fix && (
          <>
            <View style={styles.pillRow}>
              <StatusPill
                tone={state === 'fresh' ? 'success' : 'warning'}
                label={state === 'fresh' ? t(lang, 'locationCurrent') : t(lang, 'locationStaleLabel')}
              />
              <Text style={[bodySecondary, styles.flex1]}>{formatFixAge(lang, ageMs)}</Text>
            </View>
            {accuracyText && <Text style={body}>{accuracyText}</Text>}
            {quality === 'poor' && <Text style={bodySecondary}>{t(lang, 'lowAccuracyNote')}</Text>}
            <Text style={bodySecondary}>{t(lang, 'phoneLocationSource')}</Text>
            {shownAddress?.address ? (
              <>
                <Text style={bodySecondary}>
                  {t(lang, 'addressTitle')}
                  {shownAddress.approximate ? ` · ${t(lang, 'addressApproximate')}` : ''}
                </Text>
                <Text style={body}>{shownAddress.address}</Text>
              </>
            ) : shownAddress?.source === 'none' ? (
              <>
                <Text style={body}>{t(lang, 'addressUnavailable')}</Text>
                <Text style={bodySecondary}>
                  {`${t(lang, 'coordinatesLabel')}: ${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`}
                </Text>
              </>
            ) : resolving ? (
              <Text accessibilityLiveRegion="polite" style={bodySecondary}>
                {t(lang, 'addressLoading')}
              </Text>
            ) : null}
            <LocationMapPreview fix={fix} stale={state === 'stale'} summaryLabel={summaryLabel} />
          </>
        )}

        <View style={styles.pillRow}>
          <StatusPill tone={sharingTone} label={sharingLabel} />
        </View>

        <AccessibleButton
          label={t(lang, 'refreshLocation')}
          onPress={() => void refresh()}
          disabled={locating}
        />
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
