import React, { useMemo } from 'react';
import { StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

import { typography, useTheme } from '../../theme';

export type RowProps = {
  label?: string;
  value?: string | React.ReactNode;
  children?: React.ReactNode;
  style?: ViewStyle;
  labelStyle?: TextStyle;
  valueStyle?: TextStyle;
};

export function Row({ label, value, children, style, labelStyle, valueStyle }: RowProps) {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        label: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
        },
        value: {
          color: colors.text,
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
          fontWeight: typography.weight.medium,
        },
      }),
    [colors]
  );

  return (
    <View style={[styles.row, style]}>
      {label && <Text style={[styles.label, labelStyle]}>{label}</Text>}
      {value && (typeof value === 'string' ? <Text style={[styles.value, valueStyle]}>{value}</Text> : value)}
      {children}
    </View>
  );
}
