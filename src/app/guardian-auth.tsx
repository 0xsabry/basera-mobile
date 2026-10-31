/**
 * Guardian sign-in / sign-up — V1.1 redesign: brand header + form card
 * on the design system. Auth calls and honest error handling unchanged.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { Banner, BrandMark, Card, EmptyState, Screen, SectionHeader } from '../components/ui';
import { GuardianServiceError, getGuardianService } from '../guardian/GuardianService';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { radius, spacing } from '../theme/tokens';

export default function GuardianAuthScreen() {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;
  const service = getGuardianService();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (mode: 'in' | 'up') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'in') await service.signIn(email.trim(), password);
      else await service.signUp(email.trim(), password);
      if (settings.announcements) {
        void speechService.speakAnnouncement(t(lang, 'guardianSignedInAs'), lang);
      }
      router.back();
    } catch (e) {
      // Honest errors: raw server message in English mode; localized in Arabic.
      setError(
        lang === 'en' && e instanceof GuardianServiceError ? e.message : t(lang, 'guardianAuthError'),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!service.isConfigured()) {
    return (
      <Screen>
        <EmptyState glyph={GLYPHS.family} title={t(lang, 'guardian')} body={t(lang, 'guardianNotConfigured')} />
      </Screen>
    );
  }

  const inputStyle = {
    color: colors.text,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    fontSize: type.body,
  };

  return (
    <Screen>
      <View style={styles.brandRow}>
        <BrandMark size={44} />
        <SectionHeader title={t(lang, 'guardianOpenSignIn')} glyph={GLYPHS.family} />
      </View>
      <Card variant="raised">
        <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
          {t(lang, 'guardianEmail')}
        </Text>
        <TextInput
          accessibilityLabel={t(lang, 'guardianEmail')}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          placeholder={t(lang, 'guardianEmail')}
          placeholderTextColor={colors.textSecondary}
          value={email}
          onChangeText={setEmail}
          style={[styles.input, inputStyle]}
        />
        <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
          {t(lang, 'guardianPassword')}
        </Text>
        <TextInput
          accessibilityLabel={t(lang, 'guardianPassword')}
          autoCapitalize="none"
          autoComplete="password"
          secureTextEntry
          placeholder={t(lang, 'guardianPassword')}
          placeholderTextColor={colors.textSecondary}
          value={password}
          onChangeText={setPassword}
          style={[styles.input, inputStyle]}
        />
        {!!error && (
          <Banner tone="danger" title={t(lang, 'guardianAuthError')}>
            <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
              {error}
            </Text>
          </Banner>
        )}
        <AccessibleButton label={t(lang, 'guardianSignIn')} onPress={() => void run('in')} disabled={busy || !email || !password} />
        <AccessibleButton label={t(lang, 'guardianSignUp')} onPress={() => void run('up')} variant="secondary" disabled={busy || !email || !password} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  body: { lineHeight: 29 },
  label: { fontWeight: '600' },
  input: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.md,
    minHeight: 60,
  },
});
