import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { speechService } from '../../ai/SpeechService';
import { AccessibleButton } from '../../components/AccessibleButton';
import { historyStore, type HistoryItem } from '../../data/HistoryStore';
import { t } from '../../i18n/strings';
import { useSettings } from '../../state/SettingsContext';
import { spacing, type ThemeColors, type TypeScale } from '../../theme/tokens';

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
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Image source={{ uri: item.imageUri }} style={styles.thumb} accessibilityLabel={t(lang, 'imagePreview')} />
      <View style={styles.rowText}>
        <Text numberOfLines={3} style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {summary}
        </Text>
        <AccessibleButton label={t(lang, 'openDetail')} hint={label} onPress={() => onOpen(item)} />
      </View>
    </View>
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
      <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
        <AccessibleButton label={lang === 'ar' ? 'ارجع للسجل' : 'Back to history'} onPress={() => setSelected(null)} variant="secondary" />
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
            <Text style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>{selected.description}</Text>
            {(selected.detections ?? []).map((d, i) => (
              <Text key={i} style={[styles.body, { color: colors.text, fontSize: type.body }]}>
                • {lang === 'ar' ? d.labelAr : d.labelEn} ({Math.round(d.confidence * 100)}%)
              </Text>
            ))}
          </>
        ) : (
          <Text selectable style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>
            {selected.ocrText}
          </Text>
        )}
        <AccessibleButton label={t(lang, 'replay')} onPress={() => replay(selected)} />
        <AccessibleButton
          label={t(lang, 'delete')}
          variant="danger"
          onPress={async () => {
            await historyStore.remove(selected.id);
            setSelected(null);
            await refresh();
          }}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      {items.length === 0 && (
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'historyEmpty')}</Text>
      )}
      {items.map((item) => (
        <HistoryRow key={item.id} item={item} lang={lang} colors={colors} type={type} onOpen={openItem} />
      ))}
      {items.length > 0 && <AccessibleButton label={t(lang, 'clearAll')} variant="danger" onPress={confirmClear} />}
      <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>{t(lang, 'privacyBody')}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  body: { lineHeight: 28 },
  bodyLarge: { lineHeight: 32 },
  row: { borderWidth: 1.5, borderRadius: 16, padding: spacing.md, flexDirection: 'row', gap: spacing.md },
  rowText: { flex: 1 },
  thumb: { width: 84, height: 84, borderRadius: 10 },
  detailImage: { width: '100%', height: 320, borderRadius: 12 },
});
