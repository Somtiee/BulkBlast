import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextStyle, ViewStyle } from 'react-native';

import { spacing, typography, useTheme } from '../../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';

export type ButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  style?: ViewStyle;
  textStyle?: TextStyle;
};

export function Button({
  title,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  style,
  textStyle,
}: ButtonProps) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          minHeight: 48,
          paddingHorizontal: spacing[5],
          borderRadius: 14,
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          gap: spacing[2],
          borderWidth: 1,
        },
        text: {
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
          fontWeight: typography.weight.semibold,
        },
        disabled: {
          opacity: 0.5,
        },
      }),
    []
  );

  const variantStyles: Record<ButtonVariant, ViewStyle> = useMemo(
    () => ({
      primary: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
      },
      secondary: {
        backgroundColor: colors.surface,
        borderColor: colors.border,
      },
      ghost: {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
      },
      danger: {
        backgroundColor: colors.danger,
        borderColor: colors.danger,
      },
      outline: {
        backgroundColor: 'transparent',
        borderColor: colors.border,
      },
    }),
    [colors]
  );

  const pressedStyles: Record<ButtonVariant, ViewStyle> = useMemo(
    () => ({
      primary: {
        backgroundColor: colors.primaryPressed,
        borderColor: colors.primaryPressed,
      },
      secondary: {
        backgroundColor: colors.surface2,
        borderColor: colors.border,
      },
      ghost: {
        backgroundColor: colors.surface2,
        borderColor: colors.surface2,
      },
      danger: {
        backgroundColor: '#B91C1C',
        borderColor: '#B91C1C',
      },
      outline: {
        backgroundColor: colors.surface2,
        borderColor: colors.border,
      },
    }),
    [colors]
  );

  const textVariantStyles: Record<ButtonVariant, TextStyle> = useMemo(
    () => ({
      primary: {
        color: '#FFFFFF',
      },
      secondary: {
        color: colors.text,
      },
      ghost: {
        color: colors.text,
      },
      danger: {
        color: '#FFFFFF',
      },
      outline: {
        color: colors.text,
      },
    }),
    [colors]
  );

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && !isDisabled ? pressedStyles[variant] : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#FFFFFF' : colors.text} />
      ) : (
        <Text style={[styles.text, textVariantStyles[variant], textStyle]}>{title}</Text>
      )}
    </Pressable>
  );
}
