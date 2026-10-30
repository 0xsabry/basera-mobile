import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { GuardianServiceError, getGuardianService } from '../guardian/GuardianService';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { MIN_TOUCH, spacing, typeScale } from '../theme/tokens';

export default function GuardianAuthScreen() {
  const { settings, colors } = useSettings();
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
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text }]}>
          {t(lang, 'guardianNotConfigured')}
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
        {t(lang, 'guardianOpenSignIn')}
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
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      <TextInput
        accessibilityLabel={t(lang, 'guardianPassword')}
        autoCapitalize="none"
        autoComplete="password"
        secureTextEntry
        placeholder={t(lang, 'guardianPassword')}
        placeholderTextColor={colors.textSecondary}
        value={password}
        onChangeText={setPassword}
        style={[
          styles.input,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
        ]}
      />
      {!!error && (
        <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.danger }]}>
          {error}
        </Text>
      )}
      <AccessibleButton label={t(lang, 'guardianSignIn')} onPress={() => void run('in')} disabled={busy || !email || !password} />
      <AccessibleButton label={t(lang, 'guardianSignUp')} onPress={() => void run('up')} variant="secondary" disabled={busy || !email || !password} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  heading: { fontSize: typeScale.heading, fontWeight: '700' },
  body: { fontSize: typeScale.body, lineHeight: 29 },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: spacing.md,
    minHeight: MIN_TOUCH,
    fontSize: typeScale.body,
  },
});
