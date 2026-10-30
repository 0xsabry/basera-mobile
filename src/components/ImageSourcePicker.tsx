import React, { useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { CapturedImage } from '../input/ImageSource';
import { GalleryImageSource } from '../input/GalleryImageSource';
import { PhoneCameraTestSource } from '../input/PhoneCameraTestSource';
import { SAMPLES, SampleImageSource } from '../input/SampleImageSource';
import { SmartGlassesCameraSource } from '../input/SmartGlassesCameraSource';
import { t } from '../i18n/strings';
import { useSettings } from '../state/SettingsContext';
import { spacing, typeScale } from '../theme/tokens';
import { AccessibleButton } from './AccessibleButton';

interface Props {
  onImage: (image: CapturedImage) => void;
  onError: (message: string) => void;
}

/** Shared source chooser used by Detection + Text Reader screens. */
export function ImageSourcePicker({ onImage, onError }: Props) {
  const { settings, colors } = useSettings();
  const lang = settings.language;
  const [showSamples, setShowSamples] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<CapturedImage | null>) => {
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

  return (
    <View>
      <Text style={[styles.heading, { color: colors.text }]}>{t(lang, 'chooseImageSource')}</Text>
      <AccessibleButton
        label={t(lang, 'sourceGallery')}
        onPress={() => run(() => new GalleryImageSource().getImage())}
        disabled={busy}
      />
      <AccessibleButton
        label={t(lang, 'sourceCameraTest')}
        onPress={() => run(() => new PhoneCameraTestSource().getImage())}
        disabled={busy}
        variant="secondary"
      />
      <AccessibleButton
        label={t(lang, 'sourceSample')}
        onPress={() => setShowSamples((v) => !v)}
        disabled={busy}
        variant="secondary"
      />
      <AccessibleButton
        label={t(lang, 'sourceGlasses')}
        onPress={async () => {
          try {
            await new SmartGlassesCameraSource().getImage();
          } catch {
            // Typed NotAvailable error by design — explain honestly.
            Alert.alert(t(lang, 'sourceGlasses'), t(lang, 'glassesNotAvailable'));
            onError(t(lang, 'glassesNotAvailable'));
          }
        }}
        variant="secondary"
      />
      {showSamples && (
        <ScrollView horizontal contentContainerStyle={styles.sampleRow}>
          {SAMPLES.map((s) => (
            <View key={s.id} style={styles.sampleItem}>
              <Image
                source={s.module}
                style={styles.sampleThumb}
                accessibilityLabel={lang === 'ar' ? s.titleAr : s.titleEn}
              />
              <AccessibleButton
                label={lang === 'ar' ? s.titleAr : s.titleEn}
                onPress={() => run(() => new SampleImageSource(s).getImage())}
                disabled={busy}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: typeScale.heading, fontWeight: '700', marginBottom: spacing.sm },
  sampleRow: { gap: spacing.md, paddingVertical: spacing.sm },
  sampleItem: { width: 220 },
  sampleThumb: { width: 220, height: 150, borderRadius: 12, marginBottom: spacing.xs },
});
