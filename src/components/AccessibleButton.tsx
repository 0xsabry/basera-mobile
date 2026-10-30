import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useSettings } from '../state/SettingsContext';
import { BUTTON_HEIGHT, radius, typeScale } from '../theme/tokens';

interface Props {
  label: string;
  hint?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}

export function AccessibleButton({ label, hint, onPress, variant = 'primary', disabled }: Props) {
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
        { backgroundColor: bg, borderColor: colors.border, opacity: disabled ? 0.5 : pressed ? pressOpacity : 1 },
      ]}
    >
      <Text style={[styles.label, { color: fg, fontSize: type.button }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: BUTTON_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginVertical: 6,
  },
  label: { fontSize: typeScale.button, fontWeight: '700', textAlign: 'center' },
});
