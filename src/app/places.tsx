/**
 * Smart Place Memory — the user's own named places (on-device only by
 * default). Save uses the CURRENT GPS fix with permission + honest
 * accuracy/errors; descriptions are composed from stored data; delete
 * requires confirmation. Proximity reminders run in the foreground
 * (see places/proximity.ts) and background-recorded proximity events
 * are surfaced here on open.
 */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import { t } from '../i18n/strings';
import { getCurrentFix } from '../places/currentFix';
import { categoryLabel, describePlace } from '../places/PlacesAssistant';
import {
  PLACE_CATEGORIES,
  placesStore,
  type Place,
  type PlaceCategory,
} from '../places/PlacesStore';
import { announceNearbyPlaces, drainPendingProximityEvents, type PendingProximityEvent } from '../places/proximity';
import { useSettings } from '../state/SettingsContext';
import { radius, spacing } from '../theme/tokens';

interface FormState {
  name: string;
  category: PlaceCategory;
  note: string;
  entranceInfo: string;
  obstaclesNote: string;
}

const EMPTY_FORM: FormState = { name: '', category: 'custom', note: '', entranceInfo: '', obstaclesNote: '' };

const PlaceCard = React.memo(function PlaceCard({
  place,
  lang,
  colors,
  type,
  onChanged,
  onEdit,
  onDelete,
}: {
  place: Place;
  lang: 'ar' | 'en';
  colors: ReturnType<typeof useSettings>['colors'];
  type: ReturnType<typeof useSettings>['type'];
  onChanged: () => void;
  onEdit: (place: Place) => void;
  onDelete: (place: Place) => void;
}) {
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge }]}>
        {place.name}
        {place.favorite ? ' ★' : ''}
      </Text>
      {!!place.note && (
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{place.note}</Text>
      )}
      <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
        {place.lastVisitedAt
          ? `${t(lang, 'placesLastVisited')}: ${new Date(place.lastVisitedAt).toLocaleDateString(
              lang === 'ar' ? 'ar-EG' : 'en-US',
            )}`
          : t(lang, 'placesNeverVisited')}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
        {place.proximityEnabled ? t(lang, 'placesProximityOn') : t(lang, 'placesProximityOff')}
      </Text>
      <AccessibleButton
        label={t(lang, 'placesListen')}
        variant="secondary"
        onPress={() => void speechService.speak(describePlace(lang, place), lang)}
      />
      <AccessibleButton
        label={t(lang, 'placesMarkVisited')}
        variant="secondary"
        onPress={() => {
          void placesStore.markVisited(place.id).then(onChanged);
        }}
      />
      <AccessibleButton
        label={place.favorite ? `★ ${t(lang, 'placesFavorite')}` : t(lang, 'placesFavorite')}
        variant="secondary"
        onPress={() => {
          void placesStore.update(place.id, { favorite: !place.favorite }).then(onChanged);
        }}
      />
      <AccessibleButton
        label={place.proximityEnabled ? t(lang, 'placesProximityOff') : t(lang, 'placesProximityOn')}
        variant="secondary"
        onPress={() => {
          void placesStore.update(place.id, { proximityEnabled: !place.proximityEnabled }).then(onChanged);
        }}
      />
      <AccessibleButton label={t(lang, 'placesEdit')} variant="secondary" onPress={() => onEdit(place)} />
      <AccessibleButton label={t(lang, 'delete')} variant="danger" onPress={() => onDelete(place)} />
    </View>
  );
});

export default function PlacesScreen() {
  const { settings, colors, type } = useSettings();
  const lang = settings.language;
  const [places, setPlaces] = useState<Place[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [recentNear, setRecentNear] = useState<PendingProximityEvent[]>([]);

  const refresh = useCallback(async () => {
    setPlaces(await placesStore.list());
  }, []);

  const handleChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      // Surface background-recorded proximity events, then run the
      // foreground proximity check (speaks only with a granted fix).
      void drainPendingProximityEvents().then(setRecentNear);
      void announceNearbyPlaces(lang, settings.proximityRadiusM);
    }, [refresh, lang, settings.proximityRadiusM]),
  );

  const saveWithLocation = async () => {
    if (saving) return;
    if (!form.name.trim()) {
      setStatus(t(lang, 'placesNeedName'));
      void speechService.speakAnnouncement(t(lang, 'placesNeedName'), lang);
      return;
    }
    setSaving(true);
    try {
      const { fix, error } = await getCurrentFix(true);
      if (!fix) {
        const msg =
          error === 'permission' ? t(lang, 'placesLocationUnavailable') : t(lang, 'placesVoiceNoLocation');
        setStatus(msg);
        void speechService.speakAnnouncement(msg, lang);
        return;
      }
      const place = await placesStore.add({
        name: form.name.trim(),
        category: form.category,
        lat: fix.lat,
        lng: fix.lng,
        accuracyM: fix.accuracyM,
        note: form.note.trim(),
        entranceInfo: form.entranceInfo.trim() || undefined,
        obstaclesNote: form.obstaclesNote.trim() || undefined,
        favorite: false,
        proximityEnabled: true,
      });
      let msg = `${t(lang, 'placesSaved')}: ${place.name} — ${t(lang, 'placesAccuracy')}: ${
        fix.accuracyM !== null ? `±${Math.round(fix.accuracyM)} m` : '—'
      }`;
      if (fix.accuracyM !== null && fix.accuracyM > 100) msg += `\n${t(lang, 'placesLowAccuracy')}`;
      setStatus(msg);
      void speechService.speakAnnouncement(msg, lang);
      setForm(EMPTY_FORM);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await placesStore.update(editingId, {
      name: form.name.trim() || undefined,
      category: form.category,
      note: form.note.trim(),
      entranceInfo: form.entranceInfo.trim() || undefined,
      obstaclesNote: form.obstaclesNote.trim() || undefined,
    });
    setEditingId(null);
    setForm(EMPTY_FORM);
    await refresh();
  };

  const confirmDelete = useCallback((place: Place) => {
    Alert.alert(place.name, t(lang, 'placesDeleteConfirm'), [
      { text: t(lang, 'cancel'), style: 'cancel' },
      {
        text: t(lang, 'delete'),
        style: 'destructive',
        onPress: async () => {
          await placesStore.remove(place.id);
          await refresh();
        },
      },
    ]);
  }, [lang, refresh]);

  const startEdit = useCallback((place: Place) => {
    setEditingId(place.id);
    setForm({
      name: place.name,
      category: place.category,
      note: place.note,
      entranceInfo: place.entranceInfo ?? '',
      obstaclesNote: place.obstaclesNote ?? '',
    });
  }, []);

  const grouped = PLACE_CATEGORIES.map((cat) => ({
    category: cat,
    items: places.filter((p) => p.category === cat),
  })).filter((g) => g.items.length > 0);

  const inputStyle = {
    color: colors.text,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: type.body,
  };

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.container}>
      <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'placesHint')}</Text>
      {recentNear.length > 0 && (
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {t(lang, 'placesRecentNear')}: {recentNear.map((e) => e.name).join(', ')}
        </Text>
      )}

      <Text accessibilityRole="header" style={[styles.heading, { color: colors.text, fontSize: type.heading }]}>
        {editingId ? t(lang, 'placesEdit') : t(lang, 'placesAddTitle')}
      </Text>
      <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
        {t(lang, 'placesNameLabel')}
      </Text>
      <TextInput
        style={[styles.input, inputStyle]}
        value={form.name}
        onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
        placeholder={t(lang, 'placesNamePlaceholder')}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={t(lang, 'placesNameLabel')}
      />
      <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
        {t(lang, 'placesCategoryLabel')}
      </Text>
      <View style={styles.chips}>
        {PLACE_CATEGORIES.map((cat) => (
          <AccessibleButton
            key={cat}
            label={categoryLabel(lang, cat)}
            variant={form.category === cat ? 'primary' : 'secondary'}
            onPress={() => setForm((f) => ({ ...f, category: cat }))}
          />
        ))}
      </View>
      <TextInput
        style={[styles.input, inputStyle]}
        value={form.note}
        onChangeText={(v) => setForm((f) => ({ ...f, note: v }))}
        placeholder={t(lang, 'placesNoteLabel')}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={t(lang, 'placesNoteLabel')}
      />
      <TextInput
        style={[styles.input, inputStyle]}
        value={form.entranceInfo}
        onChangeText={(v) => setForm((f) => ({ ...f, entranceInfo: v }))}
        placeholder={t(lang, 'placesEntranceLabel')}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={t(lang, 'placesEntranceLabel')}
      />
      <TextInput
        style={[styles.input, inputStyle]}
        value={form.obstaclesNote}
        onChangeText={(v) => setForm((f) => ({ ...f, obstaclesNote: v }))}
        placeholder={t(lang, 'placesObstaclesLabel')}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={t(lang, 'placesObstaclesLabel')}
      />
      {!editingId && (
        <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
          {t(lang, 'placesPermissionExpl')}
        </Text>
      )}
      {editingId ? (
        <AccessibleButton label={t(lang, 'saveAction')} onPress={() => void saveEdit()} />
      ) : (
        <AccessibleButton
          label={saving ? t(lang, 'analyzing') : t(lang, 'placesSaveWithLocation')}
          onPress={() => void saveWithLocation()}
        />
      )}
      {!!status && (
        <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
          {status}
        </Text>
      )}

      {places.length === 0 && (
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{t(lang, 'placesEmpty')}</Text>
      )}
      {grouped.map((g) => (
        <View key={g.category}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text, fontSize: type.heading }]}>
            {categoryLabel(lang, g.category)}
          </Text>
          {g.items.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              lang={lang}
              colors={colors}
              type={type}
              onChanged={handleChanged}
              onEdit={startEdit}
              onDelete={confirmDelete}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  heading: { fontWeight: '700', marginTop: spacing.md },
  body: { lineHeight: 29 },
  bodyLarge: { lineHeight: 32, fontWeight: '700' },
  label: { fontWeight: '600' },
  input: { borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, minHeight: 56 },
  chips: { gap: spacing.sm },
  card: { borderWidth: 1.5, borderRadius: radius.lg, padding: spacing.md, gap: 6, marginTop: spacing.sm },
});
