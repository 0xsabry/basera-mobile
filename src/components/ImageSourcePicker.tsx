import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';
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
import { FeatureTile, SectionHeader } from './ui';

interface Props {
  onImage: (image: CapturedImage) => void;
  onError: (message: string) => void;
  /** True while the parent screen is analyzing — blocks duplicate runs. */
  disabled?: boolean;
}

/**
 * Shared source chooser used by Detection + Text Reader screens.
 * V1.1 redesign: design-system tiles with distinct glyphs; the four
 * sources and their behavior (incl. the honest glasses NotAvailable
 * alert) are unchanged.
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
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('PERMISSION_DENIED')) {
        onError(t(lang, 'permissionDenied'));
      } else {
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const off = busy || disabled;
  return (
    <View style={styles.wrap}>
      <SectionHeader title={t(lang, 'chooseImageSource')} glyph={GLYPHS.camera} />
      <FeatureTile
        glyph={GLYPHS.gallery}
        title={t(lang, 'sourceGallery')}
        disabled={off}
        onPress={() => run(() => new GalleryImageSource().getImage())}
      />
      <FeatureTile
        glyph={GLYPHS.camera}
        tone="info"
        title={t(lang, 'sourceCameraTest')}
        disabled={off}
        onPress={() => run(() => new PhoneCameraTestSource().getImage())}
      />
      <FeatureTile
        glyph={GLYPHS.sample}
        tone="neutral"
        title={t(lang, 'sourceSample')}
        disabled={off}
        onPress={() => setShowSamples((v) => !v)}
      />
      <FeatureTile
        glyph={GLYPHS.glasses}
        tone="neutral"
        title={t(lang, 'sourceGlasses')}
        subtitle={t(lang, 'glassesCardStatus')}
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
  wrap: { gap: spacing.md },
  sampleRow: { gap: spacing.md, paddingVertical: spacing.sm },
  sampleItem: { width: 220 },
  sampleThumb: { width: 220, height: 150, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.xs },
});
