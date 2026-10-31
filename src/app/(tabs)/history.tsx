/**
 * Activity history — past detections and OCR results, grouped by day.
 * V1.1 redesign: design-system rows + a card-based detail view; the
 * store, replay and delete/clear flows are unchanged.
 */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { AccessibleButton } from '../../components/AccessibleButton';
import { Card, CompactAction, EmptyState, Screen, SectionHeader } from '../../components/ui';
import { historyStore, type HistoryItem } from '../../data/HistoryStore';
import { t } from '../../i18n/strings';
import { useSettings } from '../../state/SettingsContext';
import { GLYPHS } from '../../theme/glyphs';
import { radius, spacing, type ThemeColors, type TypeScale } from '../../theme/tokens';

const HistoryRow = React.memo(function HistoryRow({
  item,
  lang,
  colors,
  type,
  onOpen,
}: {
  item: HistoryItem;
  lang: 'ar' | 'en';
  colors: ThemeColors;
  type: TypeScale;
  onOpen: (item: HistoryItem) => void;
}) {
  const summary =
    item.kind === 'detection' ? (item.description ?? '') : (item.ocrText ?? '').slice(0, 120);
  const label = `${item.kind === 'detection' ? t(lang, 'detect') : t(lang, 'readText')} — ${new Date(item.timestamp).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')} — ${summary}`;
  return (
    <Card>
      <View style={styles.rowInner}>
        <Image source={{ uri: item.imageUri }} style={styles.thumb} accessibilityLabel={t(lang, 'imagePreview')} />
        <View style={styles.rowText}>
          <Text style={[styles.kindLabel, { color: colors.textSecondary, fontSize: type.caption }]}>
            {item.kind === 'detection' ? t(lang, 'detect') : t(lang, 'readText')} ·{' '}
            {new Date(item.timestamp).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
          <Text numberOfLines={3} style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {summary}
          </Text>
        </View>
      </View>
      <CompactAction label={t(lang, 'openDetail')} glyph={item.kind === 'detection' ? GLYPHS.detect : GLYPHS.read} onPress={() => onOpen(item)} />
      {/* Screen-reader summary for the whole entry stays available. */}
      <Text accessibilityLabel={label} style={styles.srOnly} />
    </Card>
  );
});

export default function HistoryScreen() {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selected, setSelected] = useState<HistoryItem | null>(null);

  const refresh = useCallback(async () => {
    setItems(await historyStore.list());
  }, []);

  // Tab screens stay mounted — refresh on focus so new results appear.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const openItem = useCallback((item: HistoryItem) => setSelected(item), []);

  const confirmClear = () => {
    Alert.alert(t(lang, 'clearAll'), t(lang, 'clearConfirm'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      {
        text: t(lang, 'confirm'),
        style: 'destructive',
        onPress: async () => {
          await historyStore.clear();
          setSelected(null);
          await refresh();
        },
      },
    ]);
  };

  const replay = (item: HistoryItem) => {
    const text = item.kind === 'detection' ? item.description : item.ocrText;
    if (text) {
      speechService.setRate(settings.speechRate);
      void speechService.speak(text, lang);
    }
  };

  if (selected) {
    return (
      <Screen>
        <AccessibleButton
          label={lang === 'ar' ? 'ارجع للسجل' : 'Back to history'}
          onPress={() => setSelected(null)}
          variant="secondary"
        />
        <Card>
          <Image
            source={{ uri: selected.imageUri }}
            style={styles.detailImage}
            resizeMode="contain"
            accessibilityLabel={t(lang, 'imagePreview')}
          />
          <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
            {new Date(selected.timestamp).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')} — {selected.sourceKind}
          </Text>
          {selected.kind === 'detection' ? (
            <>
              <Text style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>
                {selected.description}
              </Text>
              {(selected.detections ?? []).map((d, i) => (
                <View key={i} style={styles.detRow}>
                  <Text style={[styles.body, { color: colors.text, fontSize: type.body, flex: 1 }]}>
                    • {lang === 'ar' ? d.labelAr : d.labelEn}
                  </Text>
                  <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
                    {Math.round(d.confidence * 100)}%
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <Text selectable style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>
              {selected.ocrText}
            </Text>
          )}
        </Card>
        <AccessibleButton label={t(lang, 'replay')} glyph={GLYPHS.repeat} onPress={() => replay(selected)} />
        <AccessibleButton
          label={t(lang, 'delete')}
          variant="danger"
          onPress={async () => {
            await historyStore.remove(selected.id);
            setSelected(null);
            await refresh();
          }}
        />
      </Screen>
    );
  }

  // Group entries by calendar day (newest first, store order preserved).
  const groups: { day: string; items: HistoryItem[] }[] = [];
  for (const item of items) {
    const day = new Date(item.timestamp).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    const existing = groups.find((g) => g.day === day);
    if (existing) existing.items.push(item);
    else groups.push({ day, items: [item] });
  }

  return (
    <Screen>
      {items.length === 0 && <EmptyState glyph={GLYPHS.history} title={t(lang, 'historyEmpty')} body={t(lang, 'privacyBody')} />}
      {groups.map((group) => (
        <View key={group.day} style={styles.group}>
          <SectionHeader title={group.day} glyph={GLYPHS.history} />
          {group.items.map((item) => (
            <HistoryRow key={item.id} item={item} lang={lang} colors={colors} type={type} onOpen={openItem} />
          ))}
        </View>
      ))}
      {items.length > 0 && <AccessibleButton label={t(lang, 'clearAll')} variant="danger" onPress={confirmClear} />}
      {items.length > 0 && (
        <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>{t(lang, 'privacyBody')}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 28 },
  bodyLarge: { lineHeight: 32 },
  kindLabel: { fontWeight: '700' },
  group: { gap: spacing.md },
  rowInner: { flexDirection: 'row', gap: spacing.md },
  rowText: { flex: 1, gap: 4 },
  thumb: { width: 84, height: 84, borderRadius: radius.md },
  detailImage: { width: '100%', height: 320, borderRadius: radius.md },
  detRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  srOnly: { height: 0, opacity: 0 },
});
