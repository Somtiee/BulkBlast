import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, FlatList, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { MainTabsParamList } from '../../navigation/types';
import { Button, Card } from '../../components/ui';
import { StickyAppHeader } from '../../components/ui/StickyAppHeader';
import { spacing, typography, useTheme } from '../../theme';
import { StorageService } from '../../services/StorageService';
import type { DropReceipt } from '../../types/receipt';

type Props = NativeStackScreenProps<MainTabsParamList, 'History'>;

export function History({ navigation }: Props) {
  const { colors } = useTheme();
  const PAGE_SIZE = 10;
  const [allReceipts, setAllReceipts] = useState<DropReceipt[]>([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    async function load() {
      const all = await StorageService.listReceipts();
      setAllReceipts(all.slice().reverse());
      setPage(0);
    }
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [navigation]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(allReceipts.length / PAGE_SIZE)),
    [allReceipts.length]
  );

  useEffect(() => {
    setPage((p) => Math.min(Math.max(0, p), totalPages - 1));
  }, [totalPages]);

  const items = useMemo(() => {
    const start = page * PAGE_SIZE;
    return allReceipts.slice(start, start + PAGE_SIZE);
  }, [allReceipts, page]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        statsCard: {
          margin: spacing[4],
          marginBottom: spacing[2],
          backgroundColor: colors.surface2,
          padding: spacing[4],
          borderRadius: 16,
        },
        statsTitle: {
          fontSize: 14,
          fontWeight: '600',
          color: colors.textSecondary,
          marginBottom: 16,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        statsRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        statItem: {
          gap: 4,
        },
        statsLabel: {
          color: colors.textSecondary,
          fontSize: 12,
        },
        statsValue: {
          color: colors.text,
          fontSize: 20,
          fontWeight: 'bold',
        },
        list: {
          paddingBottom: spacing[8],
        },
        receiptItem: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: spacing[4],
          borderBottomWidth: 1,
          borderBottomColor: colors.surface2,
          backgroundColor: colors.background,
        },
        receiptLeft: {
          gap: 4,
        },
        receiptTitle: {
          fontSize: 16,
          fontWeight: '600',
          color: colors.text,
        },
        receiptSub: {
          fontSize: 12,
          color: colors.textSecondary,
        },
        statusPill: {
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 12,
        },
        statusText: {
          fontSize: 10,
          fontWeight: 'bold',
          textTransform: 'uppercase',
        },
        paginationWrap: {
          paddingHorizontal: spacing[4],
          paddingBottom: spacing[8],
          paddingTop: spacing[2],
          gap: spacing[3],
        },
        paginationRow: {
          flexDirection: 'row',
          gap: spacing[2],
        },
        paginationHint: {
          color: colors.textSecondary,
          fontSize: 12,
          textAlign: 'center',
        },
      }),
    [colors]
  );

  const stats = useMemo(() => {
    const last30 = allReceipts.slice(0, 30);
    const totalDrops = last30.length;
    let totalRecipients = 0;
    let totalSuccessRecipients = 0; 
    let failedBatches = 0;

    for (const r of last30) {
      totalRecipients += r.validRecipientCount;
      const failBatches = r.batches.filter(b => !b.ok).length;
      failedBatches += failBatches;
      
      for (const b of r.batches) {
        if (b.ok) {
          totalSuccessRecipients += (b.recipientIds?.length || 0);
        }
      }
    }

    const successRate = totalRecipients > 0 ? Math.round((totalSuccessRecipients / totalRecipients) * 100) : 0;

    return { totalDrops, totalRecipients, failedBatches, successRate };
  }, [items]);

  function renderHeader() {
    if (allReceipts.length === 0) return null;
    return (
      <View style={styles.statsCard}>
        <Text style={styles.statsTitle}>Overview (Last 30)</Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statsValue}>{stats.totalDrops}</Text>
            <Text style={styles.statsLabel}>Drops</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statsValue}>{stats.totalRecipients}</Text>
            <Text style={styles.statsLabel}>Recipients</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statsValue, { color: colors.success }]}>{stats.successRate}%</Text>
            <Text style={styles.statsLabel}>Success</Text>
          </View>
        </View>
      </View>
    );
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'success': return { bg: colors.success + '20', text: colors.success };
      case 'failed': return { bg: colors.danger + '20', text: colors.danger };
      case 'partial': return { bg: colors.warning + '20', text: colors.warning };
      default: return { bg: colors.surface2, text: colors.textSecondary };
    }
  }

  function renderItem({ item }: { item: DropReceipt }) {
    const statusStyle = getStatusColor(item.status);
    const assetName = item.asset.kind === 'SOL' ? 'SOL' : item.asset.kind === 'SPL' ? (item.asset.symbol || 'SPL') : 'NFT';
    
    return (
      <Pressable 
        style={({pressed}) => [styles.receiptItem, pressed && { backgroundColor: colors.surface2 }]}
        onPress={() => navigation.navigate('CreateDropStack' as any, { screen: 'ReceiptDetails', params: { id: item.id } })}
      >
        <View style={styles.receiptLeft}>
          <Text style={styles.receiptTitle}>{item.totalAmountUi} {assetName}</Text>
          <Text style={styles.receiptSub}>{new Date(item.createdAt).toLocaleDateString()} • {item.validRecipientCount} recipients</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusStyle.bg }]}>
          <Text style={[styles.statusText, { color: statusStyle.text }]}>{item.status}</Text>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <StickyAppHeader title="History" />
      <FlatList
        data={items}
        renderItem={renderItem}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={
          allReceipts.length > 0 ? (
            <View style={styles.paginationWrap}>
              <Text style={styles.paginationHint}>
                Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, allReceipts.length)} of {allReceipts.length}
              </Text>
              <View style={styles.paginationRow}>
                <Button
                  title="Back"
                  onPress={() => setPage((p) => Math.max(0, p - 1))}
                  variant="secondary"
                  disabled={page === 0}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Next"
                  onPress={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  variant="secondary"
                  disabled={page >= totalPages - 1}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : null
        }
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}
