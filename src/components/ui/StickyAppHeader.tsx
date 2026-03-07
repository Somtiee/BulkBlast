import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { spacing, typography, useTheme } from '../../theme';

export type StickyAppHeaderProps = {
  title?: string;
  right?: React.ReactNode;
  center?: React.ReactNode;
  showLogo?: boolean;
};

export function StickyAppHeader({ title, right, center, showLogo = true }: StickyAppHeaderProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          backgroundColor: colors.background,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          paddingHorizontal: spacing[4],
          paddingBottom: spacing[2],
          zIndex: 100,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 44,
        },
        left: {
          width: 40,
          alignItems: 'flex-start',
          justifyContent: 'center',
        },
        center: {
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        rightContainer: {
          width: 40,
          alignItems: 'flex-end',
          justifyContent: 'center',
        },
        logoText: {
          color: colors.primary,
          fontSize: 20,
          fontWeight: '900', // Heavy bold
          letterSpacing: -0.5,
        },
        title: {
          color: colors.text,
          fontSize: typography.fontSize.body,
          fontWeight: typography.weight.semibold,
        },
        backButton: {
          paddingVertical: spacing[1],
          paddingRight: spacing[2],
        },
        backText: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.body,
        },
      }),
    [colors]
  );

  const goHome = () => {
    navigation.navigate('CreateDrop');
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing[2] }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {showLogo ? (
            // Logo removed from here to reduce clutter as requested, 
            // OR kept minimal if showLogo is true but center content takes priority
            center ? null : (
              <Pressable onPress={goHome} hitSlop={10}>
                <Text style={styles.logoText}></Text>
              </Pressable>
            )
          ) : (
            navigation.canGoBack() && (
              <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backButton}>
                 <Text style={styles.backText}>←</Text>
              </Pressable>
            )
          )}
        </View>
        
        <View style={styles.center}>
          {center ? center : title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
        </View>

        <View style={styles.rightContainer}>
          {right}
        </View>
      </View>
    </View>
  );
}
