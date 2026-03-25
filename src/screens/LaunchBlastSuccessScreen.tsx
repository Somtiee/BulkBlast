import React, { useMemo } from 'react';
import { StyleSheet, Text, View, Share, Platform, Linking, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';

import type { CreateDropStackParamList } from '../navigation/types';
import { Button, Card, Screen } from '../components/ui';
import { spacing, typography, useTheme } from '../theme';
import { getBagsTokenPageUrl } from '../constants/bags';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'LaunchBlastSuccess'>;

export function LaunchBlastSuccessScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { tokenMint, tokenSymbol, signature } = route.params;
  const bagsUrl = getBagsTokenPageUrl(tokenMint);
  const symbolPlain = tokenSymbol.replace(/\$/g, '');
  const ticker = `$${symbolPlain}`;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: {
          fontSize: typography.fontSize.display,
          lineHeight: typography.lineHeight.display,
          fontWeight: typography.weight.bold,
          color: colors.text,
          textAlign: 'center',
        },
        sub: {
          marginTop: spacing[2],
          fontSize: typography.fontSize.body,
          color: colors.textSecondary,
          textAlign: 'center',
        },
        linkBox: {
          marginTop: spacing[4],
          padding: spacing[4],
          backgroundColor: colors.surface2,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
        },
        linkText: {
          color: colors.primary,
          fontSize: typography.fontSize.bodySmall,
          fontWeight: typography.weight.semibold,
        },
        sigLabel: {
          marginTop: spacing[3],
          fontSize: typography.fontSize.caption,
          color: colors.textSecondary,
        },
        sigMono: {
          fontSize: typography.fontSize.caption,
          color: colors.text,
          fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        },
        inlineRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: spacing[2],
        },
        miniCopyBtn: {
          paddingVertical: 6,
          paddingHorizontal: spacing[3],
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          backgroundColor: colors.surface2,
        },
        miniCopyText: {
          color: colors.primary,
          fontSize: typography.fontSize.caption,
          fontWeight: typography.weight.semibold,
        },
      }),
    [colors],
  );

  async function onShare() {
    try {
      const message = `Check out ${ticker} on Bags\n${bagsUrl}`;
      await Share.share({
        title: `${ticker} on Bags`,
        message,
        ...(Platform.OS === 'ios' ? { url: bagsUrl } : {}),
      });
    } catch {
      // user dismissed
    }
  }

  async function onOpenBags() {
    const can = await Linking.canOpenURL(bagsUrl);
    if (can) await Linking.openURL(bagsUrl);
  }

  function onBlastNow() {
    navigation.reset({
      index: 0,
      routes: [
        {
          name: 'CreateDrop',
          params: {
            preFilledMint: tokenMint,
            preFilledSymbol: symbolPlain,
            bagsBlastBanner: true,
            launchBlastFreeFee: true,
          },
        },
      ],
    });
  }

  return (
    <Screen
      scroll
      footer={
        <Button
          title="BLAST NOW"
          onPress={onBlastNow}
          variant="primary"
          style={{ minHeight: 56 }}
          textStyle={{ fontSize: typography.fontSize.body, fontWeight: typography.weight.bold, letterSpacing: 0.5 }}
        />
      }
    >
      <Text style={styles.title}>You’re live on Bags 🎉</Text>
      <Text style={styles.sub}>
        Share your token link, then tap BLAST NOW — we’ll open Bulk Blast with this mint ready so you can bulk-send your
        new token to holders or a list.
      </Text>

      <Card style={{ marginTop: spacing[2] }}>
        <Text style={{ fontSize: typography.fontSize.bodySmall, color: colors.textSecondary, marginBottom: spacing[2] }}>
          Token
        </Text>
          <Text style={{ fontSize: typography.fontSize.body, fontWeight: typography.weight.bold, color: colors.text }}>
            {ticker}
          </Text>
        <View style={[styles.inlineRow, { marginTop: spacing[2] }]}>
          <Text style={[styles.sigMono, { flex: 1 }]} numberOfLines={1}>
            {tokenMint}
          </Text>
          <Pressable onPress={() => void Clipboard.setStringAsync(tokenMint)} style={styles.miniCopyBtn}>
            <Text style={styles.miniCopyText}>Copy</Text>
          </Pressable>
        </View>
      </Card>

      <Pressable onPress={onOpenBags} style={styles.linkBox}>
        <Text style={{ fontSize: typography.fontSize.caption, color: colors.textSecondary, marginBottom: spacing[1] }}>
          View on Bags
        </Text>
        <Text style={styles.linkText} numberOfLines={2}>
          {bagsUrl}
        </Text>
      </Pressable>

      <Button title="Share link" onPress={onShare} variant="secondary" />
      <Button
        title="Copy link"
        onPress={() => void Clipboard.setStringAsync(bagsUrl)}
        variant="outline"
        style={{ marginTop: spacing[2] }}
      />

      <Text style={styles.sigLabel}>Transaction</Text>
      <View style={[styles.inlineRow, { marginTop: spacing[1] }]}>
        <Text style={[styles.sigMono, { flex: 1 }]} selectable numberOfLines={1}>
          {signature}
        </Text>
        <Pressable onPress={() => void Clipboard.setStringAsync(signature)} style={styles.miniCopyBtn}>
          <Text style={styles.miniCopyText}>Copy</Text>
        </Pressable>
      </View>
    </Screen>
  );
}
