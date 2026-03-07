import React, { useMemo } from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from 'react-native';

import { spacing, typography, useTheme } from '../../theme';

export type InputProps = Omit<TextInputProps, 'style' | 'onChangeText' | 'value'> & {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  errorText?: string;
  inputStyle?: TextStyle;
  style?: ViewStyle;
};

export function Input({ label, value, onChangeText, errorText, inputStyle, style, ...props }: InputProps) {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          gap: spacing[2],
        },
        label: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.bodySmall,
          lineHeight: typography.lineHeight.bodySmall,
          fontWeight: typography.weight.medium,
        },
        input: {
          minHeight: 48,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: spacing[4],
          backgroundColor: colors.surface,
          color: colors.text,
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
        },
        inputError: {
          borderColor: colors.danger,
        },
        error: {
          color: colors.danger,
          fontSize: typography.fontSize.caption,
          lineHeight: typography.lineHeight.caption,
          fontWeight: typography.weight.medium,
        },
      }),
    [colors]
  );

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.textSecondary}
        style={[styles.input, inputStyle, errorText ? styles.inputError : null]}
      />
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
    </View>
  );
}
