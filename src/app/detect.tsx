/**
 * Scene description (YOLO detection) — V1.1 redesign: viewfinder
 * framing around the preview, result cards with confidence pills,
 * design-system hazard banner. Detection, hazard processing, speech
 * and history logic are unchanged.
 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { buildDescription, describeDetection } from '../ai/DescriptionBuilder';
import { DetectorUnavailableError, YoloDetector } from '../ai/ObjectDetector';
import { analyzeObstacles } from '../ai/ObstacleAwareness';
import { speechService } from '../ai/SpeechService';
import type { Detection } from '../ai/types';
import { AccessibleButton } from '../components/AccessibleButton';
import { ImageSourcePicker } from '../components/ImageSourcePicker';
import {
  ActionGrid,
  Banner,
  Card,
  CompactAction,
  QuietGroup,
  Screen,
  SectionHeader,
  StatusPill,
  ViewfinderFrame,
} from '../components/ui';
import { historyStore, persistImageCopy } from '../data/HistoryStore';
import {
  acknowledgeHazards,
  hazardAlertText,
  processHazardDetections,
} from '../hazards/HazardService';
import type { HazardAlert } from '../hazards/RiskEngine';
import type { CapturedImage } from '../input/ImageSource';
import { t } from '../i18n/strings';
import { setAccessibilityBusy } from '../state/accessibilityBusy';
import { useSettings } from '../state/SettingsContext';
import { GLYPHS } from '../theme/glyphs';
import { radius, spacing } from '../theme/tokens';

const detector = new YoloDetector();

export default function DetectScreen() {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hazardAlerts, setHazardAlerts] = useState<HazardAlert[]>([]);
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });
  const runId = useRef(0);
  const busyRef = useRef(false);

  const handleImage = async (img: CapturedImage) => {
    if (busyRef.current) return; // never run two detections at once
    busyRef.current = true;
    const id = ++runId.current;
    setImage(img);
    setError('');
    setDetections([]);
    setDescription('');
    setBusy(true);
    setAccessibilityBusy('processing', true);
    try {
      const results = await detector.detect(img);
      if (runId.current !== id) return;
      // Hazard check on THIS captured frame (scan-based, not continuous):
      // the risk engine may speak/vibrate an alert and record an event.
      const hz = await processHazardDetections(results, lang);
      if (runId.current !== id) return;
      if (hz.alerts.length > 0) setHazardAlerts(hz.alerts);
      const desc = buildDescription(results, lang);
      setDetections(results);
      setDescription(desc);
      speechService.setRate(settings.speechRate);
      if (settings.announcements) void speechService.speak(desc, lang);
      const storedUri = await persistImageCopy(img.uri);
      await historyStore.add({
        kind: 'detection',
        imageUri: storedUri,
        sourceKind: img.sourceKind,
        detections: results,
        description: desc,
      });
    } catch (e) {
      if (runId.current !== id) return;
      // Typed unavailability and Arabic mode get localized text — never a
      // raw (English) service message.
      setError(
        e instanceof DetectorUnavailableError
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

  const obstacles = analyzeObstacles(detections);
  const proxLabel = (p: string) =>
    p === 'near' ? t(lang, 'proximityNear') : p === 'medium' ? t(lang, 'proximityMedium') : t(lang, 'proximityFar');
  const posLabel = (p: string) =>
    p === 'left' ? t(lang, 'positionLeft') : p === 'right' ? t(lang, 'positionRight') : t(lang, 'positionCenter');
  const hasHigh = hazardAlerts.some((a) => a.level === 'high');

  return (
    <Screen>
      {/* Viewfinder first — the large preview area leads the screen. */}
      {image ? (
        <View style={styles.section}>
          <SectionHeader title={t(lang, 'imagePreview')} glyph={GLYPHS.camera} />
          <ViewfinderFrame>
            <View
              style={styles.previewWrap}
              onLayout={(e) => setPreviewSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            >
              <Image
                source={{ uri: image.uri }}
                style={[styles.preview, { aspectRatio: image.width / Math.max(1, image.height) }]}
                resizeMode="contain"
                accessibilityLabel={t(lang, 'imagePreview')}
              />
              {previewSize.w > 0 &&
                detections.map((d, i) => (
                  <View
                    key={i}
                    pointerEvents="none"
                    style={[
                      styles.box,
                      {
                        borderColor: colors.overlayBox,
                        left: d.box.x * previewSize.w,
                        top: d.box.y * previewSize.h,
                        width: d.box.width * previewSize.w,
                        height: d.box.height * previewSize.h,
                      },
                    ]}
                  >
                    <Text style={[styles.boxLabel, { backgroundColor: colors.overlayBox, color: colors.background }]}>
                      {lang === 'ar' ? d.labelAr : d.labelEn}
                    </Text>
                  </View>
                ))}
            </View>
          </ViewfinderFrame>
        </View>
      ) : (
        <ViewfinderFrame>
          <View style={[styles.previewPlaceholder, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={{ color: colors.textSecondary, fontSize: 44, lineHeight: 52 }}>{GLYPHS.camera}</Text>
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

      {hazardAlerts.length > 0 && (
        <Banner tone={hasHigh ? 'danger' : 'warning'} glyph={GLYPHS.alerts} title={t(lang, 'alertsLatest')}>
          <View accessibilityLiveRegion="assertive" style={styles.section}>
            {hazardAlerts.map((a) => (
              <Text key={a.id} style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>
                {hazardAlertText(lang, a)}
              </Text>
            ))}
          </View>
          <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
            {t(lang, 'hazardScanNote')}
          </Text>
          <AccessibleButton
            label={t(lang, 'iAmOk')}
            onPress={() => {
              void acknowledgeHazards();
              setHazardAlerts([]);
            }}
          />
          <AccessibleButton
            label={t(lang, 'repeatWarning')}
            variant="secondary"
            onPress={() => void speechService.repeatAlert()}
          />
        </Banner>
      )}

      {!!description && (
        <QuietGroup>
          <Text accessibilityLiveRegion="polite" style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>
            {description}
          </Text>
        </QuietGroup>
      )}

      {detections.length > 0 && (
        <>
          <SectionHeader title={t(lang, 'detectionsFound')} glyph={GLYPHS.detect} />
          <QuietGroup>
            {detections.map((d, i) => (
              <View key={i} style={styles.detRow}>
                <Text style={[styles.body, { color: colors.text, fontSize: type.body, flex: 1 }]}>
                  {describeDetection(d, lang)}
                </Text>
                <StatusPill tone="neutral" glyph={GLYPHS.check} label={`${Math.round(d.confidence * 100)}%`} />
              </View>
            ))}
          </QuietGroup>
          <SectionHeader title={t(lang, 'obstacleSummary')} glyph={GLYPHS.alerts} />
          <QuietGroup>
            {obstacles.slice(0, 5).map((o, i) => (
              <Text key={i} style={[styles.body, { color: colors.text, fontSize: type.body }]}>
                • {lang === 'ar' ? o.detection.labelAr : o.detection.labelEn} — {posLabel(o.position)} — {proxLabel(o.proximity)}
              </Text>
            ))}
          </QuietGroup>
        </>
      )}

      <ActionGrid>
        <CompactAction
          label={t(lang, 'speak')}
          glyph={GLYPHS.speak}
          variant="primary"
          onPress={() => description && void speechService.speak(description, lang)}
          disabled={!description}
        />
        <CompactAction label={t(lang, 'repeat')} glyph={GLYPHS.repeat} onPress={() => void speechService.repeatLast()} />
        <CompactAction label={t(lang, 'stopSpeaking')} glyph={GLYPHS.stop} onPress={() => void speechService.stop()} />
      </ActionGrid>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
  bodyLarge: { lineHeight: 32, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  section: { gap: spacing.sm },
  previewWrap: { position: 'relative', width: '100%' },
  previewPlaceholder: {
    width: '100%',
    minHeight: 240,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  preview: { width: '100%', borderRadius: radius.md },
  box: { position: 'absolute', borderWidth: 3, borderRadius: 4 },
  boxLabel: { fontSize: 14, fontWeight: '700', paddingHorizontal: 4, alignSelf: 'flex-start' },
  detRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
