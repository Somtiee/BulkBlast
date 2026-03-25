import React, { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, ViewStyle, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { spacing, typography, useTheme } from '../../theme';

export type ScreenProps = {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  /**
   * Android-only: pull down to "refresh" by popping to the top of the current stack.
   */
  pullToHome?: boolean;
};

export function Screen({
  title,
  subtitle,
  children,
  footer,
  scroll = true,
  contentStyle,
  pullToHome = true,
}: ScreenProps) {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safe: {
          flex: 1,
          backgroundColor: colors.background,
        },
        scrollContainer: {
          paddingBottom: spacing[8],
        },
        content: {
          paddingHorizontal: spacing[6],
          paddingTop: spacing[6],
          gap: spacing[5],
        },
        titleBlock: {
          gap: spacing[2],
        },
        titleTextWrap: {
          height: 0,
        },
        subtitleTextWrap: {
          height: 0,
        },
        titleText: {
          color: colors.text,
          fontSize: typography.fontSize.display,
          lineHeight: typography.lineHeight.display,
          fontWeight: typography.weight.bold,
          letterSpacing: -0.2,
        },
        subtitleText: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
          fontWeight: typography.weight.regular,
        },
        footer: {
          marginTop: spacing[4],
        },
      }),
    [colors]
  );

  function TextBlock({ kind, children }: TextBlockProps) {
    return <Text style={kind === 'title' ? styles.titleText : styles.subtitleText}>{children}</Text>;
  }

  const content = (
    <View style={[styles.content, contentStyle]}>
      {title ? (
        <View style={styles.titleBlock}>
          <TextBlock kind="title">{title}</TextBlock>
          {subtitle ? <TextBlock kind="subtitle">{subtitle}</TextBlock> : null}
        </View>
      ) : null}
      {children}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );

  function onRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      navigation?.popToTop?.();
    } catch {
      // ignore
    } finally {
      // UX: keep it snappy; no async work required.
      setTimeout(() => setRefreshing(false), 350);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            Platform.OS === 'android' && pullToHome ? (
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            ) : undefined
          }
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

type TextBlockProps = { kind: 'title' | 'subtitle'; children: string };
