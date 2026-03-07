import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { spacing, useTheme } from '../../theme';

export type CardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
};

export function Card({ children, style }: CardProps) {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 16,
          padding: spacing[5],
        },
      }),
    [colors]
  );

  return <View style={[styles.card, style]}>{children}</View>;
}
