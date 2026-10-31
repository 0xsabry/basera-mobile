/**
 * Text reader (OCR) — V1.1 redesign: viewfinder framing, result card
 * with a detected-language pill, action grid. Recognition routing,
 * speech and history logic are unchanged.
 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { OcrUnavailableError, RoutingTextRecognizer } from '../ai/TextRecognizer';
import type { OcrResult } from '../ai/types';
import { ImageSourcePicker } from '../components/ImageSourcePicker';
import {
  ActionGrid,
  Banner,
  Card,
  CompactAction,
  Icon,
  QuietGroup,
  Screen,
  SectionHeader,
  StatusPill,
  ViewfinderFrame,
} from '../components/ui';
import { historyStore, persistImageCopy } from '../data/HistoryStore';
import type { CapturedImage } from '../input/ImageSource';
import { t } from '../i18n/strings';
import { setAccessibilityBusy } from '../state/accessibilityBusy';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { radius, spacing } from '../theme/tokens';

export default function ReadScreen() {
  const { settings, colors, type } = useSettings();
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
    <Screen>
      {/* Viewfinder first — the large preview area leads the screen. */}
      {image ? (
        <ViewfinderFrame>
          <Image
            source={{ uri: image.uri }}
            style={[styles.preview, { aspectRatio: image.width / Math.max(1, image.height) }]}
            resizeMode="contain"
            accessibilityLabel={t(lang, 'imagePreview')}
          />
        </ViewfinderFrame>
      ) : (
        <ViewfinderFrame>
          <View style={[styles.previewPlaceholder, { backgroundColor: colors.surfaceAlt }]}>
            <Icon glyph={GLYPHS.read} size={24} tone="muted" />
            <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
              {t(lang, 'imagePreview')}
            </Text>
          </View>
        </ViewfinderFrame>
      )}

      {/* Slim source control bar under the preview. */}
      <ImageSourcePicker onImage={handleImage} onError={setError} disabled={busy} />
      {busy && (
        <Card>
          <View style={styles.row}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'analyzing')}</Text>
          </View>
        </Card>
      )}
      {!!error && (
        <Banner tone="danger" title={t(lang, 'errorGeneric')}>
          <Text accessibilityLiveRegion="assertive" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {error}
          </Text>
        </Banner>
      )}
      {result && (
        <>
          <SectionHeader title={t(lang, 'ocrResult')} glyph={GLYPHS.read} />
          <QuietGroup>
          <View style={styles.row}>
            <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
              {t(lang, 'detectedLanguage')}:
            </Text>
            <StatusPill tone="neutral" glyph={GLYPHS.language} label={langLabel(result.language)} />
          </View>
          {result.text ? (
            <Text selectable style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>
              {result.text}
            </Text>
          ) : result.engineNote === 'arabic-unsupported' ? (
            <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'arabicOcrUnsupported')}</Text>
          ) : (
            <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'noTextFound')}</Text>
          )}
          </QuietGroup>
        </>
      )}
      <ActionGrid>
        <CompactAction
          label={t(lang, 'speak')}
          glyph={GLYPHS.speak}
          variant="primary"
          onPress={() => result?.text && void speechService.speak(spokenText(result), lang)}
          disabled={!result?.text}
        />
        <CompactAction label={t(lang, 'repeat')} glyph={GLYPHS.repeat} onPress={() => void speechService.repeatLast()} />
        <CompactAction label={t(lang, 'stopSpeaking')} glyph={GLYPHS.stop} onPress={() => void speechService.stop()} />
      </ActionGrid>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
  bodyLarge: { lineHeight: 34 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  previewPlaceholder: {
    width: '100%',
    minHeight: 240,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  preview: { width: '100%', borderRadius: radius.md },
});
