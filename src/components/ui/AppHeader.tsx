import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing, typography, useTheme } from '../../theme';

export type AppHeaderProps = {
  title: string;
  canGoBack: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
};

export function AppHeader({ title, canGoBack, onBack, right }: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          backgroundColor: colors.background,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          paddingHorizontal: spacing[6],
          paddingBottom: spacing[3],
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
        },
        left: {
          width: 72,
          alignItems: 'flex-start',
        },
        right: {
          width: 72,
          alignItems: 'flex-end',
        },
        title: {
          flex: 1,
          textAlign: 'center',
          color: colors.text,
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
          fontWeight: typography.weight.semibold,
          letterSpacing: -0.1,
        },
        backButton: {
          paddingVertical: spacing[1],
          paddingHorizontal: spacing[2],
          borderRadius: 10,
        },
        backText: {
          color: colors.text,
          fontSize: typography.fontSize.bodySmall,
          lineHeight: typography.lineHeight.bodySmall,
          fontWeight: typography.weight.medium,
        },
        backPlaceholder: {
          width: 44,
          height: 32,
        },
      }),
    [colors]
  );

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing[3] }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {canGoBack ? (
            <Pressable accessibilityRole="button" onPress={onBack} hitSlop={10} style={styles.backButton}>
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          ) : (
            <View style={styles.backPlaceholder} />
          )}
        </View>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        <View style={styles.right}>{right ?? <View style={styles.backPlaceholder} />}</View>
      </View>
    </View>
  );
}
