import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { spacing, typography, useTheme } from '../../theme';

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
};

export function Chip({ label, selected = false, onPress, style }: ChipProps) {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[2],
          borderRadius: 999,
          borderWidth: 1,
          alignSelf: 'flex-start',
        },
        selected: {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
        },
        unselected: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        pressed: {
          opacity: 0.85,
        },
        text: {
          fontSize: typography.fontSize.bodySmall,
          lineHeight: typography.lineHeight.bodySmall,
          fontWeight: typography.weight.medium,
        },
        textSelected: {
          color: '#FFFFFF',
        },
        textUnselected: {
          color: colors.text,
        },
      }),
    [colors]
  );

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.unselected,
        pressed && onPress ? styles.pressed : null,
        style,
      ]}
    >
      <Text style={[styles.text, selected ? styles.textSelected : styles.textUnselected]}>{label}</Text>
    </Pressable>
  );
}
