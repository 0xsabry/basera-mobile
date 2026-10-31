/**
 * OSM tile map preview for a real fix — a small, decorative visual
 * companion to the spoken/textual location details (the details are
 * the accessible content; the container carries them as its label).
 *
 * Policy (see guardian/mapConfig.ts): only the tiles intersecting
 * this viewport are requested, each with the explicit BASERA
 * User-Agent, and the © OpenStreetMap contributors attribution is
 * always visible. If ANY tile fails to load, the whole preview falls
 * back to a details-only box — a partial map is never presented as
 * complete. The marker distinguishes a fresh fix (filled dot) from a
 * stale one (hollow, dashed, faded) so staleness is visible, not just
 * stated in the text next to it.
 */
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  MAP_DEFAULT_ZOOM,
  MAP_TILE_SIZE,
  MAP_TILE_USER_AGENT,
  tileUrl,
} from '../guardian/mapConfig';
import { tilesForViewport } from '../guardian/tileMath';
import { t } from '../i18n/strings';
import type { GeoFix } from '../places/currentFix';
import { useSettings } from '../state/SettingsContext';
import { radius, spacing } from '../theme/tokens';

export const MAP_PREVIEW_HEIGHT = 200;
const MARKER_SIZE = 22;

interface Props {
  fix: GeoFix;
  stale: boolean;
  /** Full spoken-style summary (my location + state + accuracy). */
  summaryLabel: string;
}

export function LocationMapPreview({ fix, stale, summaryLabel }: Props) {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;
  const [width, setWidth] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  // A new fix is a new map: a previous tile failure must not stick.
  useEffect(() => {
    setFailed(false);
  }, [fix.lat, fix.lng, fix.at]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };

  if (failed) {
    return (
      <View
        accessible
        accessibilityLabel={`${summaryLabel}. ${t(lang, 'mapLoadFailed')}`}
        onLayout={onLayout}
        style={[styles.box, styles.fallback, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      >
        <Text style={{ color: colors.text, fontSize: type.body, lineHeight: type.body * 1.4 }}>
          {t(lang, 'mapLoadFailed')}
        </Text>
        <AttributionChip />
      </View>
    );
  }

  const viewport =
    width === null
      ? null
      : tilesForViewport({
          lat: fix.lat,
          lng: fix.lng,
          zoom: MAP_DEFAULT_ZOOM,
          width,
          height: MAP_PREVIEW_HEIGHT,
          tileSize: MAP_TILE_SIZE,
        });

  return (
    <View
      accessible
      accessibilityLabel={summaryLabel}
      onLayout={onLayout}
      style={[styles.box, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
    >
      {viewport?.tiles.map((tile) => (
        <Image
          key={tile.key}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          source={{ uri: tileUrl(tile.x, tile.y, MAP_DEFAULT_ZOOM), headers: { 'User-Agent': MAP_TILE_USER_AGENT } }}
          onError={() => setFailed(true)}
          style={[styles.tile, { left: tile.left, top: tile.top }]}
        />
      ))}
      {viewport && (
        <View
          accessibilityElementsHidden
          style={[
            styles.marker,
            {
              left: viewport.markerLeft - MARKER_SIZE / 2,
              top: viewport.markerTop - MARKER_SIZE / 2,
            },
            stale
              ? {
                  backgroundColor: colors.surface,
                  borderColor: colors.textSecondary,
                  borderStyle: 'dashed' as const,
                  borderWidth: 2,
                  opacity: 0.65,
                }
              : {
                  backgroundColor: colors.primary,
                  borderColor: '#FFFFFF',
                  borderWidth: 3,
                },
          ]}
        />
      )}
      <AttributionChip />
    </View>
  );
}

function AttributionChip() {
  const { settings, colors, type } = useSettings();
  return (
    <View
      accessibilityElementsHidden
      style={[styles.attribution, { backgroundColor: colors.surfaceAlt }]}
    >
      <Text style={{ color: colors.text, fontSize: type.caption, lineHeight: type.caption * 1.3 }}>
        {t(settings.language, 'mapAttribution')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    height: MAP_PREVIEW_HEIGHT,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  fallback: { alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  tile: { position: 'absolute', width: MAP_TILE_SIZE, height: MAP_TILE_SIZE },
  marker: { position: 'absolute', width: MARKER_SIZE, height: MARKER_SIZE, borderRadius: MARKER_SIZE / 2 },
  attribution: {
    position: 'absolute',
    bottom: spacing.xs,
    right: spacing.xs,
    borderRadius: radius.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
});
