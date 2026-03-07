import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { useTheme } from '../../theme';

export type DividerProps = {
  style?: ViewStyle;
};

export function Divider({ style }: DividerProps) {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        divider: {
          height: StyleSheet.hairlineWidth,
          backgroundColor: colors.border,
        },
      }),
    [colors]
  );

  return <View style={[styles.divider, style]} />;
}
