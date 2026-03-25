import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';

import type { CreateDropStackParamList } from '../navigation/types';
import { Button, Card, Screen } from '../components/ui';
import { StorageService, type BagsLaunchHistoryItem } from '../services/StorageService';
import { spacing, typography, useTheme } from '../theme';
import { getBagsTokenPageUrl } from '../constants/bags';
import { getNetwork } from '../services/SolanaService';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'LaunchBlastHistory'>;

const PAGE_SIZE = 10;

function getExplorerTxUrl(signature: string): string {
  const cluster = getNetwork() === 'devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

export function LaunchBlastHistoryScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const [all, setAll] = useState<BagsLaunchHistoryItem[]>([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    async function load() {
      const items = await StorageService.listBagsLaunches();
      const ordered = items.slice().sort((a, b) => b.createdAt - a.createdAt);
      setAll(ordered);
      setPage(0);
    }
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation]);

  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const pageItems = useMemo(() => {
    const start = page * PAGE_SIZE;
    return all.slice(start, start + PAGE_SIZE);
  }, [all, page]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(0, p), totalPages - 1));
  }, [totalPages]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        empty: {
          color: colors.textSecondary,
          textAlign: 'center',
          fontSize: typography.fontSize.body,
          paddingVertical: spacing[8],
        },
        row: {
          gap: spacing[2],
        },
        symbol: {
          color: colors.text,
          fontSize: typography.fontSize.body,
          fontWeight: typography.weight.bold,
        },
        meta: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.caption,
        },
        mono: {
          color: colors.text,
          fontSize: typography.fontSize.caption,
          fontFamily: 'monospace',
        },
        inline: {
          flexDirection: 'row',
          alignItems: 'center',
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
        pagerWrap: {
          gap: spacing[2],
          marginTop: spacing[2],
        },
        pagerText: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.caption,
          textAlign: 'center',
        },
        pagerRow: {
          flexDirection: 'row',
          gap: spacing[2],
        },
      }),
    [colors]
  );

  async function openUrl(url: string) {
    try {
      const can = await Linking.canOpenURL(url);
      if (can) await Linking.openURL(url);
    } catch {
      // ignore
    }
  }

  return (
    <Screen scroll contentStyle={{ paddingBottom: spacing[8] }}>
      {all.length === 0 ? (
        <Card>
          <Text style={styles.empty}>No launch history yet.</Text>
        </Card>
      ) : (
        <>
          {pageItems.map((item) => {
            const bagsUrl = getBagsTokenPageUrl(item.tokenMint);
            const txUrl = getExplorerTxUrl(item.signature);
            return (
              <Card key={item.signature} style={styles.row}>
                <Text style={styles.symbol}>${item.tokenSymbol || 'TOKEN'}</Text>
                <Text style={styles.meta}>
                  {new Date(item.createdAt).toLocaleString()}
                </Text>

                <Text style={styles.meta}>Mint</Text>
                <View style={styles.inline}>
                  <Text style={[styles.mono, { flex: 1 }]} numberOfLines={1}>
                    {item.tokenMint}
                  </Text>
                  <Pressable
                    onPress={() => void Clipboard.setStringAsync(item.tokenMint)}
                    style={styles.miniCopyBtn}
                  >
                    <Text style={styles.miniCopyText}>Copy</Text>
                  </Pressable>
                </View>

                <Text style={[styles.meta, { marginTop: spacing[1] }]}>Transaction</Text>
                <View style={styles.inline}>
                  <Text style={[styles.mono, { flex: 1 }]} numberOfLines={1}>
                    {item.signature}
                  </Text>
                  <Pressable
                    onPress={() => void Clipboard.setStringAsync(item.signature)}
                    style={styles.miniCopyBtn}
                  >
                    <Text style={styles.miniCopyText}>Copy</Text>
                  </Pressable>
                </View>

                <View style={[styles.pagerRow, { marginTop: spacing[2] }]}>
                  <Button title="Open Bags" variant="secondary" onPress={() => void openUrl(bagsUrl)} style={{ flex: 1 }} />
                  <Button title="Open Tx" variant="secondary" onPress={() => void openUrl(txUrl)} style={{ flex: 1 }} />
                </View>
              </Card>
            );
          })}

          <View style={styles.pagerWrap}>
            <Text style={styles.pagerText}>
              Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, all.length)} of {all.length}
            </Text>
            <View style={styles.pagerRow}>
              <Button
                title="Back"
                variant="outline"
                onPress={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{ flex: 1 }}
              />
              <Button
                title="Next"
                variant="outline"
                onPress={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </>
      )}
    </Screen>
  );
}
