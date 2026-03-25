import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, Text, ScrollView, Share, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CreateDropStackParamList } from '../../navigation/types';
import { Button, Card, Screen, Row, Divider } from '../../components/ui';
import { spacing, typography, useTheme } from '../../theme';
import type { DropReceipt } from '../../types/receipt';
import { StorageService } from '../../services/StorageService';
import { exportReceiptCsv } from '../../services/ExportService';
import { TOKENS } from '../../config/tokens';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'ReceiptDetails'>;

export function ReceiptDetails({ navigation, route }: Props) {
  const { colors } = useTheme();
  const [receipt, setReceipt] = useState<DropReceipt | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    async function load() {
      const all = await StorageService.listReceipts();
      const found = all.find((r) => r.id === route.params.id) || null;
      setReceipt(found);
    }
    load();
  }, [route.params.id]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          fontSize: typography.fontSize.title,
          lineHeight: typography.lineHeight.title,
          fontWeight: typography.weight.semibold,
          color: colors.text,
          marginBottom: spacing[2],
        },
        pillSuccess: { color: colors.success },
        pillFailed: { color: colors.danger },
        list: { maxHeight: 300 },
        sig: { color: colors.textSecondary, fontSize: typography.fontSize.caption },
        err: { color: colors.danger, fontSize: 11 },
        longValue: {
          maxWidth: '62%',
          flexShrink: 1,
          textAlign: 'right',
        },
      }),
    [colors]
  );

  function shortSig(sig: string) {
    if (sig.length <= 14) return sig;
    return `${sig.slice(0, 6)}…${sig.slice(-6)}`;
  }

  if (!receipt) {
    return (
      <Screen title="Receipt">
        <Card>
          <Text style={styles.header}>Not found</Text>
          <Button title="Back" onPress={() => navigation.goBack()} variant="secondary" />
        </Card>
      </Screen>
    );
  }

  const okCount = receipt.batches.filter((b) => b.ok).length;
  const failCount = receipt.batches.filter((b) => !b.ok).length;
  const feeTokenLabel =
    receipt.fee.feeMint === TOKENS.SOL.mint
      ? 'SOL'
      : receipt.fee.feeMint === TOKENS.SKR.mint
      ? 'SKR'
      : receipt.fee.feeMint;

  async function onExportCsv() {
    if (!receipt || exporting) return;
    setExporting(true);
    try {
      await exportReceiptCsv(receipt);
    } catch (e: any) {
      Alert.alert('Export Failed', e.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen title="Receipt" subtitle={receipt.id}>
      <Card>
        <Row label="Created" value={new Date(receipt.createdAt).toLocaleString()} />
        <Row label="Network" value={receipt.network} />
        <Row label="Asset" value={receipt.asset.kind === 'SOL' ? 'SOL' : receipt.asset.kind === 'SPL' ? (receipt.asset.symbol || 'SPL') : 'NFT'} />
        <Row label="Recipients" value={`${receipt.validRecipientCount}/${receipt.recipientCount}`} />
        <Row label="Total" value={receipt.totalAmountUi} />
        <Row label="Status" value={receipt.status} valueStyle={receipt.status === 'success' ? styles.pillSuccess : receipt.status === 'failed' ? styles.pillFailed : undefined} />
        <Divider />
        <Row label="Fee Token" value={feeTokenLabel} />
        <Row label="Fee Amount" value={`${receipt.fee.feeTokens} ${feeTokenLabel}`} />
        {receipt.fee.discounted ? <Text style={{ color: colors.success }}>Discount applied</Text> : null}
      </Card>

      <Card>
        <Text style={styles.header}>Batches</Text>
        <ScrollView style={styles.list}>
          {receipt.batches.map((b) => (
            <View key={b.batchIndex} style={{ paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: colors.surface2 }}>
              <Row label={`Batch #${b.batchIndex + 1}`} value={b.ok ? 'Success' : 'Failed'} valueStyle={b.ok ? styles.pillSuccess : styles.pillFailed} />
              {b.signature ? <Text style={styles.sig}>{shortSig(b.signature)}</Text> : null}
              {b.error ? <Text style={styles.err}>{b.error}</Text> : null}
            </View>
          ))}
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] }}>
          <Button 
            title={exporting ? "Exporting..." : "Export CSV"} 
            onPress={onExportCsv} 
            variant="secondary" 
            disabled={exporting}
          />
          <Button title="Back" onPress={() => navigation.goBack()} />
        </View>
      </Card>

      <Card>
        <Row label="Success" value={okCount.toString()} />
        <Row label="Failed" value={failCount.toString()} />
      </Card>
    </Screen>
  );
}
