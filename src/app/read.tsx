import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { OcrUnavailableError, RoutingTextRecognizer } from '../ai/TextRecognizer';
import type { OcrResult } from '../ai/types';
import { AccessibleButton } from '../components/AccessibleButton';
import { ImageSourcePicker } from '../components/ImageSourcePicker';
import { historyStore, persistImageCopy } from '../data/HistoryStore';
import type { CapturedImage } from '../input/ImageSource';
import { t } from '../i18n/strings';
import { setAccessibilityBusy } from '../state/accessibilityBusy';
import { useSettings } from '../state/SettingsContext';
import { spacing, typeScale } from '../theme/tokens';

export default function ReadScreen() {
  const { settings, colors } = useSettings();
  const lang = settings.language;
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const runId = useRef(0);
  const busyRef = useRef(false);

  const spokenText = (r: OcrResult) =>
    lang === 'ar' ? `النص بيقول: ${r.text}` : `The text says: ${r.text}`;

  const handleImage = async (img: CapturedImage) => {
    if (busyRef.current) return; // never run two OCR passes at once
    busyRef.current = true;
    const id = ++runId.current;
    setImage(img);
    setError('');
    setResult(null);
    setBusy(true);
    setAccessibilityBusy('processing', true);
    try {
      const r = await new RoutingTextRecognizer(lang).recognize(img);
      if (runId.current !== id) return;
      setResult(r);
      if (r.text) {
        speechService.setRate(settings.speechRate);
        if (settings.announcements) void speechService.speak(spokenText(r), lang);
        const storedUri = await persistImageCopy(img.uri);
        await historyStore.add({
          kind: 'ocr',
          imageUri: storedUri,
          sourceKind: img.sourceKind,
          ocrText: r.text,
          ocrLanguage: r.language,
        });
      }
    } catch (e) {
      if (runId.current !== id) return;
      // Typed unavailability and Arabic mode get localized text — never a
      // raw (English) service message.
      setError(
        e instanceof OcrUnavailableError
          ? t(lang, 'featureUnavailableInBuild')
          : lang === 'ar'
            ? t(lang, 'errorGeneric')
            : e instanceof Error
              ? e.message
              : t(lang, 'errorGeneric'),
      );
    } finally {
      busyRef.current = false;
      setAccessibilityBusy('processing', false);
      if (runId.current === id) setBusy(false);
    }
  };

  const langLabel = (l: string) =>
    l === 'ar' ? t(lang, 'langAr') : l === 'en' ? t(lang, 'langEn') : l === 'mixed' ? t(lang, 'langMixed') : t(lang, 'langUnknown');

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <ImageSourcePicker onImage={handleImage} onError={setError} disabled={busy} />
      {busy && (
        <View style={styles.row}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'analyzing')}</Text>
        </View>
      )}
      {!!error && (
        <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.danger }]}>
          {error}
        </Text>
      )}
      {image && (
        <Image
          source={{ uri: image.uri }}
          style={[styles.preview, { aspectRatio: image.width / Math.max(1, image.height) }]}
          resizeMode="contain"
          accessibilityLabel={t(lang, 'imagePreview')}
        />
      )}
      {result && (
        <View>
          <Text style={[styles.heading, { color: colors.text }]}>{t(lang, 'ocrResult')}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {t(lang, 'detectedLanguage')}: {langLabel(result.language)}
          </Text>
          {result.text ? (
            <Text selectable style={[styles.bodyLarge, { color: colors.text }]}>
              {result.text}
            </Text>
          ) : result.engineNote === 'arabic-unsupported' ? (
            <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'arabicOcrUnsupported')}</Text>
          ) : (
            <Text style={[styles.body, { color: colors.text }]}>{t(lang, 'noTextFound')}</Text>
          )}
        </View>
      )}
      <AccessibleButton
        label={t(lang, 'speak')}
        onPress={() => result?.text && void speechService.speak(spokenText(result), lang)}
        disabled={!result?.text}
      />
      <AccessibleButton label={t(lang, 'repeat')} onPress={() => void speechService.repeatLast()} variant="secondary" />
      <AccessibleButton label={t(lang, 'stopSpeaking')} onPress={() => void speechService.stop()} variant="secondary" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  heading: { fontSize: typeScale.heading, fontWeight: '700' },
  body: { fontSize: typeScale.body, lineHeight: 29 },
  bodyLarge: { fontSize: typeScale.bodyLarge, lineHeight: 34 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  preview: { width: '100%', borderRadius: 12 },
});
