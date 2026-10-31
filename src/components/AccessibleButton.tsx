import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSettings } from '../state/SettingsContext';
import { BUTTON_HEIGHT, elevation, radius, typeScale } from '../theme/tokens';

interface Props {
  label: string;
  hint?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  /** Optional leading system glyph (design system src/theme/glyphs.ts). */
  glyph?: string;
}

/**
 * The app's standard large action button — full-width, ≥64dp, with
 * design-system surfaces: filled primary/danger with elevation, soft
 * secondary with a border. Variants are distinguished by label weight
 * and (for danger) a leading ✕ glyph slot is available, never by
 * color alone — the text label always says what the button does.
 */
export function AccessibleButton({ label, hint, onPress, variant = 'primary', disabled, glyph }: Props) {
  const { colors, type, settings } = useSettings();
  const bg =
    variant === 'primary' ? colors.primary : variant === 'danger' ? colors.danger : colors.surfaceAlt;
  const fg = variant === 'secondary' ? colors.text : variant === 'danger' ? '#FFFFFF' : colors.primaryText;
  // Reduced-motion preference removes the press fade effect entirely.
  const pressOpacity = settings.reducedMotion ? 1 : 0.85;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === 'secondary' ? colors.border : bg,
          shadowColor: colors.shadow,
          elevation: variant === 'secondary' ? 0 : elevation.card,
          opacity: disabled ? 0.5 : pressed ? pressOpacity : 1,
        },
      ]}
    >
      <Text style={[styles.label, { color: fg, fontSize: type.button }]}>
        {glyph ? `${glyph}  ` : ''}
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: BUTTON_HEIGHT,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginVertical: 6,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  label: { fontSize: typeScale.button, fontWeight: '700', textAlign: 'center', lineHeight: 28 },
});
