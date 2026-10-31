/**
 * BASERA V1.1 design-system primitives.
 *
 * Every screen is composed from these — no screen hand-rolls card,
 * header, pill or tile styles any more. All primitives read the live
 * theme (colors + scaled type + reduced-motion + language direction)
 * from SettingsContext, so light/dark/high-contrast, larger text and
 * RTL/LTR all flow through automatically.
 *
 * Accessibility contract (unchanged from the app-wide rules):
 * - touch targets ≥ 56dp (rows/tiles ≥ 72dp),
 * - status = glyph + text, never color alone,
 * - every interactive element carries role + label (+ hint where the
 *   underlying action is not obvious),
 * - press feedback is opacity only, and is disabled entirely when the
 *   user enabled reduced motion.
 */
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../state/SettingsContext';
import { forwardChevron, GLYPHS } from '../theme/glyphs';
import { elevation, radius, spacing } from '../theme/tokens';

export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface ToneColors {
  soft: string;
  on: string;
  solid: string;
}

function toneColors(colors: ReturnType<typeof useSettings>['colors'], tone: Tone): ToneColors {
  switch (tone) {
    case 'success':
      return { soft: colors.successSoft, on: colors.onSuccessSoft, solid: colors.success };
    case 'warning':
      return { soft: colors.warningSoft, on: colors.onWarningSoft, solid: colors.warning };
    case 'danger':
      return { soft: colors.dangerSoft, on: colors.onDangerSoft, solid: colors.danger };
    case 'info':
      return { soft: colors.infoSoft, on: colors.onInfoSoft, solid: colors.info };
    case 'neutral':
      return { soft: colors.surfaceAlt, on: colors.textSecondary, solid: colors.textSecondary };
    default:
      return { soft: colors.primarySoft, on: colors.onPrimarySoft, solid: colors.primary };
  }
}

const TONE_GLYPHS: Record<Tone, string> = {
  primary: GLYPHS.check,
  success: GLYPHS.check,
  warning: GLYPHS.alerts,
  danger: GLYPHS.error,
  info: GLYPHS.info,
  neutral: GLYPHS.empty,
};

/* ------------------------------------------------------------------ */
/* Screen scaffold                                                     */
/* ------------------------------------------------------------------ */

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useSettings();
  const insets = useSafeAreaInsets();
  const content = (
    <View style={[styles.screenContent, { paddingBottom: spacing.xl + insets.bottom }, style]}>
      {children}
    </View>
  );
  if (!scroll) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}>{content}</View>;
  }
  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.grow}>
      {content}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Brand + headers                                                     */
/* ------------------------------------------------------------------ */

export function BrandMark({ size = 52 }: { size?: number }) {
  const { colors } = useSettings();
  const dotSize = Math.max(6, size * 0.16);
  return (
    <View
      accessibilityElementsHidden
      style={[
        styles.brandMark,
        {
          width: size,
          height: size,
          borderRadius: size * 0.3,
          backgroundColor: colors.primary,
          borderColor: colors.accent,
          shadowColor: colors.shadow,
        },
      ]}
    >
      <Text style={{ color: colors.primaryText, fontSize: size * 0.52, fontWeight: '800', lineHeight: size * 0.62 }}>
        {GLYPHS.brand}
      </Text>
      {/* The letter's own dot, in accent — the "eye" of the mark. It
          sits below the «ب» exactly where its dot belongs. */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.16,
          width: dotSize,
          height: dotSize,
          borderRadius: radius.pill,
          backgroundColor: colors.accent,
        }}
      />
    </View>
  );
}

export function AppHeader({
  brandName,
  tagline,
  greeting,
  dateLine,
}: {
  brandName: string;
  tagline: string;
  greeting: string;
  dateLine: string;
}) {
  const { colors, type } = useSettings();
  return (
    <View style={styles.appHeader}>
      <View style={styles.brandRow}>
        <BrandMark size={44} />
        <View style={styles.brandText}>
          <Text accessibilityRole="header" style={[styles.brandName, { color: colors.text, fontSize: type.bodyLarge }]}>
            {brandName}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: type.caption, lineHeight: type.caption * 1.3 }}>
            {tagline}
          </Text>
        </View>
      </View>
      {/* The greeting is the display element; the date stays a quiet caption. */}
      <Text style={[styles.greeting, { color: colors.text, fontSize: type.title }]}>{greeting}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: type.caption, lineHeight: type.caption * 1.35 }}>
        {dateLine}
      </Text>
    </View>
  );
}

export function SectionHeader({
  title,
  glyph,
  tone = 'primary',
}: {
  title: string;
  glyph?: string;
  tone?: Tone;
}) {
  const { colors, type } = useSettings();
  const tc = toneColors(colors, tone);
  return (
    <View style={styles.sectionHeader} accessible accessibilityRole="header" accessibilityLabel={title}>
      {glyph ? (
        <View style={[styles.sectionGlyph, { backgroundColor: tc.soft }]}>
          <Text style={{ color: tc.on, fontSize: 17, fontWeight: '800' }}>{glyph}</Text>
        </View>
      ) : null}
      <Text style={[styles.sectionTitle, { color: colors.text, fontSize: type.heading }]}>{title}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  tone,
  style,
  accessibilityLabel,
  variant = 'flat',
}: {
  children: React.ReactNode;
  tone?: Tone;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /**
   * `flat` (default) is the disciplined surface: 1px border, no
   * elevation. `raised` is reserved for the ONE hero-adjacent surface
   * on a screen (a form, the release-note card) that must stand out.
   */
  variant?: 'flat' | 'raised';
}) {
  const { colors } = useSettings();
  const borderColor = tone ? toneColors(colors, tone).solid : colors.border;
  const raised = variant === 'raised';
  return (
    <View
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor,
          shadowColor: colors.shadow,
          borderWidth: tone ? 2 : 1,
          elevation: raised ? elevation.raised : elevation.flat,
          shadowOpacity: raised ? 0.3 : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Banner({
  tone,
  glyph,
  title,
  children,
}: {
  tone: Tone;
  glyph?: string;
  title: string;
  children?: React.ReactNode;
}) {
  const { colors, type } = useSettings();
  const tc = toneColors(colors, tone);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tc.soft, borderColor: tc.solid, borderWidth: 1.5, shadowColor: colors.shadow },
      ]}
    >
      <View style={styles.bannerTitleRow}>
        <Text style={{ color: tc.on, fontSize: type.bodyLarge, fontWeight: '800' }}>
          {glyph ?? TONE_GLYPHS[tone]}
        </Text>
        <Text
          accessibilityRole="header"
          style={{ color: tc.on, fontSize: type.body, fontWeight: '800', flex: 1, lineHeight: type.body * 1.4 }}
        >
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

export function EmptyState({ glyph = GLYPHS.empty, title, body }: { glyph?: string; title: string; body?: string }) {
  const { colors, type } = useSettings();
  return (
    <Card accessibilityLabel={body ? `${title}. ${body}` : title}>
      <View style={styles.emptyState}>
        <Text style={{ color: colors.textSecondary, fontSize: 40, lineHeight: 48 }}>{glyph}</Text>
        <Text style={[styles.emptyTitle, { color: colors.text, fontSize: type.bodyLarge }]}>{title}</Text>
        {body ? (
          <Text style={{ color: colors.textSecondary, fontSize: type.body, lineHeight: type.body * 1.45, textAlign: 'center' }}>
            {body}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Pills, tiles, rows                                                  */
/* ------------------------------------------------------------------ */

export function StatusPill({ tone, label, glyph }: { tone: Tone; label: string; glyph?: string }) {
  const { colors, type } = useSettings();
  const tc = toneColors(colors, tone);
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.pill, { backgroundColor: tc.soft, borderColor: tc.solid }]}
    >
      <Text style={{ color: tc.on, fontSize: type.caption, fontWeight: '800' }}>{glyph ?? TONE_GLYPHS[tone]}</Text>
      <Text
        style={{
          color: tc.on,
          fontSize: type.caption,
          fontWeight: '700',
          lineHeight: type.caption * 1.3,
          flexShrink: 1,
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function IconTile({ glyph, tone = 'primary', size = 52 }: { glyph: string; tone?: Tone; size?: number }) {
  const { colors } = useSettings();
  const tc = toneColors(colors, tone);
  return (
    <View
      accessibilityElementsHidden
      style={[
        styles.iconTile,
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: tc.soft },
      ]}
    >
      <Text style={{ color: tc.on, fontSize: size * 0.46, fontWeight: '700', lineHeight: size * 0.56 }}>
        {glyph}
      </Text>
    </View>
  );
}

export function FeatureTile({
  glyph,
  tone = 'primary',
  title,
  subtitle,
  onPress,
  hint,
  layout = 'row',
  badge,
  disabled,
}: {
  glyph: string;
  tone?: Tone;
  title: string;
  subtitle?: string;
  onPress: () => void;
  hint?: string;
  layout?: 'row' | 'grid';
  badge?: string;
  disabled?: boolean;
}) {
  const { colors, type, settings } = useSettings();
  const isRTL = settings.language === 'ar';
  const pressOpacity = settings.reducedMotion ? 1 : 0.86;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${title}. ${badge}` : title}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        layout === 'grid' ? styles.tileGrid : styles.tileRow,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          shadowColor: colors.shadow,
          opacity: disabled ? 0.5 : pressed ? pressOpacity : 1,
        },
      ]}
    >
      <IconTile glyph={glyph} tone={tone} size={layout === 'grid' ? 48 : 52} />
      <View style={styles.tileText}>
        <Text style={{ color: colors.text, fontSize: type.body, fontWeight: '700', lineHeight: type.body * 1.3 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{ color: colors.textSecondary, fontSize: type.caption, lineHeight: type.caption * 1.35 }}
            numberOfLines={2}
          >
            {subtitle}
          </Text>
        ) : null}
        {badge ? (
          <Text style={{ color: colors.danger, fontSize: type.caption, fontWeight: '800' }}>{badge}</Text>
        ) : null}
      </View>
      {layout === 'row' ? (
        <Text style={{ color: colors.textSecondary, fontSize: 26, fontWeight: '700' }}>
          {forwardChevron(isRTL)}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function FeatureGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

export function ListRow({
  glyph,
  tone = 'primary',
  title,
  subtitle,
  right,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  variant = 'card',
}: {
  glyph?: string;
  tone?: Tone;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /**
   * `card` (default) is a standalone flat row with its own border.
   * `quiet` drops the border/background entirely — for rows living
   * inside a QuietGroup, where hairline dividers do the separation.
   */
  variant?: 'card' | 'quiet';
}) {
  const { colors, type, settings } = useSettings();
  const isRTL = settings.language === 'ar';
  const pressOpacity = settings.reducedMotion ? 1 : 0.86;
  const inner = (
    <>
      {glyph ? <IconTile glyph={glyph} tone={tone} size={46} /> : null}
      <View style={styles.tileText}>
        <Text style={{ color: colors.text, fontSize: type.body, fontWeight: '600', lineHeight: type.body * 1.35 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: colors.textSecondary, fontSize: type.caption, lineHeight: type.caption * 1.4 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && !right ? (
        <Text style={{ color: colors.textSecondary, fontSize: 26, fontWeight: '700' }}>
          {forwardChevron(isRTL)}
        </Text>
      ) : null}
    </>
  );
  const quiet = variant === 'quiet';
  const rowStyle: ViewStyle = quiet
    ? { backgroundColor: 'transparent', borderWidth: 0, elevation: 0, shadowOpacity: 0 }
    : { backgroundColor: colors.surface, borderColor: colors.border, shadowColor: colors.shadow };
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        style={({ pressed }) => [styles.listRow, rowStyle, { opacity: pressed ? pressOpacity : 1 }]}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}. ${subtitle}` : title)}
      style={[styles.listRow, rowStyle]}
    >
      {inner}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Quiet groups, status strips, timeline                               */
/* ------------------------------------------------------------------ */

/**
 * QuietGroup — a section without a card box: children stacked on the
 * screen background, separated by hairline dividers. This is the
 * default grouping for Settings, History detail, permissions and
 * other list-like content; cards are reserved for forms and the one
 * raised surface per screen.
 */
export function QuietGroup({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useSettings();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.quietGroup, style]}>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          {i > 0 ? (
            <View style={[styles.hairline, { backgroundColor: colors.border }]} accessibilityElementsHidden />
          ) : null}
          {child}
        </React.Fragment>
      ))}
    </View>
  );
}

/**
 * StatusStrip — a single slim status row: a 40dp glyph tile, a title,
 * and a StatusPill. Flat (border only, no elevation). Tappable when
 * `onPress` is given, in which case a forward chevron closes the row.
 * Status is always glyph + pill text, never color alone.
 */
export function StatusStrip({
  glyph,
  glyphTone = 'neutral',
  title,
  pillLabel,
  pillTone = 'neutral',
  pillGlyph,
  onPress,
  accessibilityLabel,
  accessibilityHint,
}: {
  glyph: string;
  glyphTone?: Tone;
  title: string;
  pillLabel: string;
  pillTone?: Tone;
  pillGlyph?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const { colors, type, settings } = useSettings();
  const isRTL = settings.language === 'ar';
  const pressOpacity = settings.reducedMotion ? 1 : 0.86;
  const inner = (
    <>
      <IconTile glyph={glyph} tone={glyphTone} size={40} />
      <Text
        style={{ color: colors.text, fontSize: type.body, fontWeight: '700', lineHeight: type.body * 1.3, flex: 1 }}
      >
        {title}
      </Text>
      <StatusPill tone={pillTone} glyph={pillGlyph} label={pillLabel} />
      {onPress ? (
        <Text style={{ color: colors.textSecondary, fontSize: 24, fontWeight: '700' }}>
          {forwardChevron(isRTL)}
        </Text>
      ) : null}
    </>
  );
  const label = accessibilityLabel ?? `${title}. ${pillLabel}`;
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        onPress={onPress}
        style={({ pressed }) => [
          styles.statusStrip,
          { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? pressOpacity : 1 },
        ]}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.statusStrip, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {inner}
    </View>
  );
}

/**
 * TimelineRow — a history entry on a date rail: a dot on a vertical
 * line, with the entry content beside it. The rail is decorative
 * (hidden from screen readers); the content carries the semantics.
 */
export function TimelineRow({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  const { colors } = useSettings();
  return (
    <View style={styles.timelineRow}>
      <View style={styles.timelineRail} accessibilityElementsHidden>
        <View style={[styles.timelineDot, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]} />
        {!last ? <View style={[styles.timelineLine, { backgroundColor: colors.border }]} /> : null}
      </View>
      <View style={styles.timelineContent}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export function HeroAction({
  label,
  hint,
  glyph = GLYPHS.voice,
  stateLabel,
  onPress,
  disabled,
}: {
  label: string;
  hint?: string;
  glyph?: string;
  stateLabel?: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, type, settings } = useSettings();
  const pressOpacity = settings.reducedMotion ? 1 : 0.9;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={stateLabel ? `${label}. ${stateLabel}` : label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.hero,
        {
          backgroundColor: colors.heroBackground,
          shadowColor: colors.shadow,
          opacity: disabled ? 0.55 : pressed ? pressOpacity : 1,
        },
      ]}
    >
      <View style={[styles.heroDisc, { backgroundColor: colors.heroText }]}>
        <Text style={{ color: colors.heroBackground, fontSize: 30, fontWeight: '800', lineHeight: 36 }}>
          {glyph}
        </Text>
      </View>
      <View style={styles.tileText}>
        <Text style={{ color: colors.heroText, fontSize: type.bodyLarge, fontWeight: '800', lineHeight: type.bodyLarge * 1.3 }}>
          {label}
        </Text>
        {stateLabel ? (
          <Text style={{ color: colors.heroTextSecondary, fontSize: type.caption, lineHeight: type.caption * 1.35 }}>
            {stateLabel}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const { colors, type, settings } = useSettings();
  const pressOpacity = settings.reducedMotion ? 1 : 0.86;
  return (
    <View style={[styles.segmentWrap, { backgroundColor: colors.surfaceAlt }]} accessibilityLabel={accessibilityLabel}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected, checked: selected }}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.segment,
              {
                backgroundColor: selected ? colors.primary : 'transparent',
                opacity: pressed ? pressOpacity : 1,
              },
            ]}
          >
            <Text
              style={{
                color: selected ? colors.primaryText : colors.text,
                fontSize: type.body,
                fontWeight: selected ? '800' : '600',
                lineHeight: type.body * 1.3,
                textAlign: 'center',
              }}
            >
              {selected ? `${GLYPHS.check} ` : ''}
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CompactAction({
  label,
  glyph,
  variant = 'secondary',
  onPress,
  disabled,
}: {
  label: string;
  glyph?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors, type, settings } = useSettings();
  const bg =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.dangerSoft : colors.surfaceAlt;
  const fg =
    variant === 'primary' ? colors.primaryText : variant === 'danger' ? colors.onDangerSoft : colors.text;
  const pressOpacity = settings.reducedMotion ? 1 : 0.85;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.compact,
        { backgroundColor: bg, borderColor: colors.border, opacity: disabled ? 0.5 : pressed ? pressOpacity : 1 },
      ]}
    >
      <Text style={{ color: fg, fontSize: type.caption, fontWeight: '700', textAlign: 'center', lineHeight: type.caption * 1.3 }}>
        {glyph ? `${glyph}  ` : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function ActionGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/** Viewfinder-style frame with corner brackets for camera/image previews. */
export function ViewfinderFrame({ children }: { children: React.ReactNode }) {
  const { colors } = useSettings();
  const corner = (style: StyleProp<ViewStyle>) => (
    <View pointerEvents="none" style={[styles.corner, { borderColor: colors.primary }, style]} />
  );
  return (
    <View style={styles.frameWrap}>
      {children}
      {corner({ top: -2, start: -2, borderTopWidth: 4, borderStartWidth: 4, borderTopStartRadius: radius.md })}
      {corner({ top: -2, end: -2, borderTopWidth: 4, borderEndWidth: 4, borderTopEndRadius: radius.md })}
      {corner({ bottom: -2, start: -2, borderBottomWidth: 4, borderStartWidth: 4, borderBottomStartRadius: radius.md })}
      {corner({ bottom: -2, end: -2, borderBottomWidth: 4, borderEndWidth: 4, borderBottomEndRadius: radius.md })}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  screenContent: { padding: spacing.lg, gap: spacing.md },
  appHeader: { gap: spacing.xs, marginBottom: spacing.xs },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandMark: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    elevation: elevation.raised,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  brandText: { flex: 1, gap: 2 },
  brandName: { fontWeight: '800' },
  greeting: { fontWeight: '800', marginTop: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  sectionGlyph: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontWeight: '800', flex: 1 },
  card: {
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
    elevation: elevation.card,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 5,
  },
  bannerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emptyState: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  emptyTitle: { fontWeight: '700', textAlign: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    alignSelf: 'flex-start',
    // Inside rows (StatusStrip, pill rows) a long localized label must
    // compress and wrap instead of pushing content off-screen.
    flexShrink: 1,
  },
  iconTile: { alignItems: 'center', justifyContent: 'center' },
  tileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 76,
    borderWidth: 1,
    borderRadius: radius.row,
    padding: spacing.md,
    elevation: elevation.flat,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 5,
  },
  tileGrid: {
    flexBasis: '46%',
    flexGrow: 1,
    gap: spacing.sm,
    minHeight: 118,
    borderWidth: 1,
    borderRadius: radius.row,
    padding: spacing.md,
    elevation: elevation.flat,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 5,
  },
  tileText: { flex: 1, gap: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    borderWidth: 1,
    borderRadius: radius.row,
    padding: spacing.md,
    elevation: elevation.flat,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 5,
  },
  quietGroup: { gap: spacing.sm, paddingVertical: spacing.xs },
  hairline: { height: StyleSheet.hairlineWidth, opacity: 0.55, marginHorizontal: spacing.xs },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    borderWidth: 1,
    borderRadius: radius.row,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    elevation: elevation.flat,
  },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineRail: { width: 18, alignItems: 'center' },
  timelineDot: { width: 13, height: 13, borderRadius: radius.pill, borderWidth: 2, marginTop: spacing.sm },
  timelineLine: { flex: 1, width: 2, opacity: 0.5, marginTop: spacing.xxs },
  timelineContent: { flex: 1, gap: spacing.sm, paddingBottom: spacing.md },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 96,
    borderRadius: radius.hero,
    padding: spacing.lg,
    elevation: elevation.hero,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  heroDisc: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    borderRadius: radius.row,
    padding: spacing.xxs,
  },
  segment: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: 52,
    borderWidth: 0,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  compact: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 56,
    borderWidth: 1,
    borderRadius: radius.row,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  frameWrap: { position: 'relative' },
  corner: { position: 'absolute', width: 30, height: 30 },
});
