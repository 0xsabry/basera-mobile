/**
 * Smart Place Memory — the user's own named places (on-device only by
 * default). Save uses the CURRENT GPS fix with permission + honest
 * accuracy/errors; descriptions are composed from stored data; delete
 * requires confirmation. Proximity reminders run in the foreground
 * (see places/proximity.ts) and background-recorded proximity events
 * are surfaced here on open.
 *
 * V1.1 redesign: design-system cards with category glyphs, a segmented
 * category picker, and a compact action grid per place. Store calls
 * and flows are unchanged.
 */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { speechService } from '../ai/SpeechService';
import { AccessibleButton } from '../components/AccessibleButton';
import {
  ActionGrid,
  Banner,
  Card,
  CompactAction,
  EmptyState,
  Icon,
  IconTile,
  QuietGroup,
  Screen,
  SectionHeader,
  SegmentedControl,
  StatusPill,
} from '../components/ui';
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
import { GLYPHS, PLACE_CATEGORY_GLYPHS } from '../theme/glyphs';
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
    <View style={styles.placeRow}>
      <View style={styles.placeHead}>
        <IconTile glyph={PLACE_CATEGORY_GLYPHS[place.category] ?? GLYPHS.places} />
        <Text style={[styles.bodyLarge, { color: colors.text, fontSize: type.bodyLarge, flex: 1 }]}>
          {place.name}
        </Text>
        {place.favorite ? <Icon glyph={GLYPHS.star} tone="warning" /> : null}
        <StatusPill
          tone={place.proximityEnabled ? 'success' : 'neutral'}
          glyph={GLYPHS.location}
          label={place.proximityEnabled ? t(lang, 'placesProximityOn') : t(lang, 'placesProximityOff')}
        />
      </View>
      {!!place.note && (
        <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>{place.note}</Text>
      )}
      <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
        {categoryLabel(lang, place.category)} ·{' '}
        {place.lastVisitedAt
          ? `${t(lang, 'placesLastVisited')}: ${new Date(place.lastVisitedAt).toLocaleDateString(
              lang === 'ar' ? 'ar-EG' : 'en-US',
            )}`
          : t(lang, 'placesNeverVisited')}
      </Text>
      <ActionGrid>
        <CompactAction
          label={t(lang, 'placesListen')}
          glyph={GLYPHS.speak}
          onPress={() => void speechService.speak(describePlace(lang, place), lang)}
        />
        <CompactAction
          label={t(lang, 'placesMarkVisited')}
          glyph={GLYPHS.check}
          onPress={() => {
            void placesStore.markVisited(place.id).then(onChanged);
          }}
        />
        <CompactAction
          label={t(lang, 'placesFavorite')}
          glyph={GLYPHS.star}
          onPress={() => {
            void placesStore.update(place.id, { favorite: !place.favorite }).then(onChanged);
          }}
        />
        <CompactAction
          label={place.proximityEnabled ? t(lang, 'placesProximityOff') : t(lang, 'placesProximityOn')}
          glyph={GLYPHS.location}
          onPress={() => {
            void placesStore.update(place.id, { proximityEnabled: !place.proximityEnabled }).then(onChanged);
          }}
        />
        <CompactAction label={t(lang, 'placesEdit')} onPress={() => onEdit(place)} />
        <CompactAction label={t(lang, 'delete')} variant="danger" onPress={() => onDelete(place)} />
      </ActionGrid>
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
    backgroundColor: colors.surfaceAlt,
    fontSize: type.body,
  };

  const field = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) => (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>{label}</Text>
      <TextInput
        style={[styles.input, inputStyle]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={label}
      />
    </View>
  );

  return (
    <Screen>
      <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>{t(lang, 'placesHint')}</Text>
      {recentNear.length > 0 && (
        <Banner tone="info" glyph={GLYPHS.location} title={t(lang, 'placesRecentNear')}>
          <Text style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {recentNear.map((e) => e.name).join(', ')}
          </Text>
        </Banner>
      )}

      <SectionHeader title={editingId ? t(lang, 'placesEdit') : t(lang, 'placesAddTitle')} glyph={GLYPHS.places} />
      <Card>
        {field(t(lang, 'placesNameLabel'), form.name, (v) => setForm((f) => ({ ...f, name: v })), t(lang, 'placesNamePlaceholder'))}
        <Text style={[styles.label, { color: colors.textSecondary, fontSize: type.caption }]}>
          {t(lang, 'placesCategoryLabel')}
        </Text>
        <SegmentedControl
          accessibilityLabel={t(lang, 'placesCategoryLabel')}
          value={form.category}
          onChange={(v) => setForm((f) => ({ ...f, category: v }))}
          options={PLACE_CATEGORIES.map((cat) => ({
            value: cat,
            label: `${PLACE_CATEGORY_GLYPHS[cat] ?? ''} ${categoryLabel(lang, cat)}`,
          }))}
        />
        {field(t(lang, 'placesNoteLabel'), form.note, (v) => setForm((f) => ({ ...f, note: v })), t(lang, 'placesNoteLabel'))}
        {field(t(lang, 'placesEntranceLabel'), form.entranceInfo, (v) => setForm((f) => ({ ...f, entranceInfo: v })), t(lang, 'placesEntranceLabel'))}
        {field(t(lang, 'placesObstaclesLabel'), form.obstaclesNote, (v) => setForm((f) => ({ ...f, obstaclesNote: v })), t(lang, 'placesObstaclesLabel'))}
        {!editingId && (
          <Text style={[styles.body, { color: colors.textSecondary, fontSize: type.body }]}>
            {t(lang, 'placesPermissionExpl')}
          </Text>
        )}
        {editingId ? (
          <AccessibleButton label={t(lang, 'saveAction')} glyph={GLYPHS.check} onPress={() => void saveEdit()} />
        ) : (
          <AccessibleButton
            label={saving ? t(lang, 'analyzing') : t(lang, 'placesSaveWithLocation')}
            glyph={GLYPHS.location}
            onPress={() => void saveWithLocation()}
          />
        )}
        {!!status && (
          <Text accessibilityLiveRegion="polite" style={[styles.body, { color: colors.text, fontSize: type.body }]}>
            {status}
          </Text>
        )}
      </Card>

      {places.length === 0 && <EmptyState glyph={GLYPHS.places} title={t(lang, 'placesEmpty')} />}
      {grouped.map((g) => (
        <View key={g.category} style={styles.group}>
          <SectionHeader
            title={categoryLabel(lang, g.category)}
            glyph={PLACE_CATEGORY_GLYPHS[g.category] ?? GLYPHS.places}
          />
          <QuietGroup>
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
          </QuietGroup>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 29 },
  bodyLarge: { lineHeight: 32, fontWeight: '700' },
  label: { fontWeight: '600' },
  input: { borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md, minHeight: 56 },
  field: { gap: spacing.xs },
  group: { gap: spacing.md },
  placeRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  placeHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
