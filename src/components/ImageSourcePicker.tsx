import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';
import { classifyImageError } from '../ai/normalizeImage';
import type { CapturedImage } from '../input/ImageSource';
import { GalleryImageSource } from '../input/GalleryImageSource';
import { PhoneCameraTestSource } from '../input/PhoneCameraTestSource';
import { SAMPLES, SampleImageSource } from '../input/SampleImageSource';
import { SmartGlassesCameraSource } from '../input/SmartGlassesCameraSource';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { radius, spacing } from '../theme/tokens';
import { AccessibleButton } from './AccessibleButton';
import { CompactAction, SectionHeader, StatusPill } from './ui';

interface Props {
  onImage: (image: CapturedImage) => void;
  onError: (message: string) => void;
  /** True while the parent screen is analyzing — blocks duplicate runs. */
  disabled?: boolean;
}

/**
 * Shared source chooser used by Detection + Text Reader screens.
 * V1.1 redesign: a slim horizontal control bar (compact actions, the
 * phone camera is the single filled primary) sitting UNDER the large
 * preview area on its screen; the four sources and their behavior
 * (incl. the honest glasses NotAvailable alert) are unchanged.
 */
export function ImageSourcePicker({ onImage, onError, disabled = false }: Props) {
  const { settings, colors } = useSettings();
  const lang = settings.language;
  const [showSamples, setShowSamples] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<CapturedImage | null>) => {
    if (busy || disabled) return; // one capture/analysis at a time
    setBusy(true);
    try {
      const img = await fn();
      if (img) onImage(img);
    } catch (e) {
      // Every failure kind gets its LOCALIZED message — raw/native
      // messages are never shown verbatim.
      switch (classifyImageError(e).kind) {
        case 'permission-denied':
          onError(t(lang, 'permissionDenied'));
          break;
        case 'unsupported-format':
          onError(t(lang, 'imageErrorUnsupported'));
          break;
        case 'decode-failed':
          onError(t(lang, 'imageErrorDecode'));
          break;
        case 'model-failed':
          onError(t(lang, 'featureUnavailableInBuild'));
          break;
        case 'processing-failed':
        default:
          onError(t(lang, 'imageErrorProcessing'));
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  const off = busy || disabled;
  return (
    <View style={styles.wrap}>
      <SectionHeader title={t(lang, 'chooseImageSource')} glyph={GLYPHS.camera} />
      <View style={styles.controlBar}>
        <CompactAction
          glyph={GLYPHS.camera}
          label={t(lang, 'sourceCameraTest')}
          variant="primary"
          disabled={off}
          onPress={() => run(() => new PhoneCameraTestSource().getImage())}
        />
        <CompactAction
          glyph={GLYPHS.gallery}
          label={t(lang, 'sourceGallery')}
          disabled={off}
          onPress={() => run(() => new GalleryImageSource().getImage())}
        />
        <CompactAction
          glyph={GLYPHS.sample}
          label={t(lang, 'sourceSample')}
          disabled={off}
          onPress={() => setShowSamples((v) => !v)}
        />
        <CompactAction
          glyph={GLYPHS.glasses}
          label={t(lang, 'sourceGlasses')}
          disabled={off}
          onPress={async () => {
            try {
              await new SmartGlassesCameraSource().getImage();
            } catch {
              // Typed NotAvailable error by design — explain honestly.
              Alert.alert(t(lang, 'sourceGlasses'), t(lang, 'glassesNotAvailable'));
              onError(t(lang, 'glassesNotAvailable'));
            }
          }}
        />
      </View>
      <StatusPill tone="neutral" glyph={GLYPHS.glasses} label={t(lang, 'glassesCardStatus')} />
      {showSamples && (
        <ScrollView horizontal contentContainerStyle={styles.sampleRow}>
          {SAMPLES.map((s) => (
            <View key={s.id} style={styles.sampleItem}>
              <Image
                source={s.module}
                style={[styles.sampleThumb, { borderColor: colors.border }]}
                accessibilityLabel={lang === 'ar' ? s.titleAr : s.titleEn}
              />
              <AccessibleButton
                label={lang === 'ar' ? s.titleAr : s.titleEn}
                onPress={() => run(() => new SampleImageSource(s).getImage())}
                disabled={off}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  controlBar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sampleRow: { gap: spacing.md, paddingVertical: spacing.sm },
  sampleItem: { width: 220 },
  sampleThumb: { width: 220, height: 150, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.xs },
});
