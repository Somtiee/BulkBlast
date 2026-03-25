import React, { useMemo, useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PublicKey } from '@solana/web3.js';
import Constants from 'expo-constants';

import type { CreateDropStackParamList } from '../../navigation/types';
import { Button, Card, Screen, Row, Divider } from '../../components/ui';
import { spacing, typography, useTheme } from '../../theme';
import { useApp } from '../../state/context';
import { getConnection, getNetwork } from '../../services/SolanaService';
import { buildSolBatches, buildSplBatches, type BuildResult, type BuiltBatch } from '../../services/TransactionService';
import { signTransaction } from '../../services/WalletService';
import type { BatchReceipt, DropReceipt } from '../../types/receipt';
import { StorageService } from '../../services/StorageService';
import { NftTransferService } from '../../services/NftTransferService';
import { DetectedNftAsset, DetectedNftItem } from '../../types/nft';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'ExecuteProgress'>;

export function ExecuteProgress({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { state } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [receipts, setReceipts] = useState<BatchReceipt[]>([]);
  const [dropReceipt, setDropReceipt] = useState<DropReceipt | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [batchesPage, setBatchesPage] = useState(0);
  const BATCHES_PAGE_SIZE = 5;

  const recipientsToUse = useMemo(() => {
    if (state.giveawayConfig.enabled) {
      const base = state.recipients.filter((r) => state.giveawayConfig.selectedRecipientIds.includes(r.id));
      if (route.params?.failedRecipientIds && route.params.failedRecipientIds.length > 0) {
        const set = new Set(route.params.failedRecipientIds);
        return base.filter((r) => set.has(r.id));
      }
      return base;
    }
    if (route.params?.failedRecipientIds && route.params.failedRecipientIds.length > 0) {
      const set = new Set(route.params.failedRecipientIds);
      return state.recipients.filter((r) => set.has(r.id));
    }
    return state.recipients;
  }, [state.recipients, state.giveawayConfig]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        status: {
          marginBottom: spacing[4],
          color: colors.textSecondary,
          fontSize: typography.fontSize.body,
        },
        progressBar: {
          height: 8,
          backgroundColor: colors.surface2,
          borderRadius: 4,
          overflow: 'hidden',
        },
        progressFill: {
          height: '100%',
          backgroundColor: colors.primary,
        },
        header: {
          fontSize: typography.fontSize.title,
          lineHeight: typography.lineHeight.title,
          fontWeight: typography.weight.semibold,
          color: colors.text,
          marginBottom: spacing[2],
        },
        pillSuccess: {
          color: colors.success,
        },
        pillFailed: {
          color: colors.danger,
        },
        sigText: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.caption,
        },
        detailsText: {
          color: colors.textSecondary,
          fontSize: 11,
        },
      }),
    [colors]
  );

  const isConfirmed = route.params?.confirmed;

  function onFinish() {
    navigation.popToTop();
  }

  async function hapticImpactLight() {
    try {
      const Haptics = await import('expo-haptics');
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {}
  }

  async function hapticNotifySuccess() {
    try {
      const Haptics = await import('expo-haptics');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}
  }

  async function hapticNotifyWarning() {
    try {
      const Haptics = await import('expo-haptics');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {}
  }

  async function hapticNotifyError() {
    try {
      const Haptics = await import('expo-haptics');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } catch {}
  }

  async function notify(title: string, body: string) {
    try {
      if (Constants?.appOwnership === 'expo') return;
      const Notifications = await import('expo-notifications');
      await Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: null,
      });
    } catch {}
  }

  function shortSig(sig: string) {
    if (sig.length <= 14) return sig;
    return `${sig.slice(0, 6)}…${sig.slice(-6)}`;
  }

  const validRecipientCount = recipientsToUse.filter((r) => r.isValid).length;
  const estimatedBatchCount = Math.ceil(Math.max(0, validRecipientCount) / Math.max(1, state.sendConfig.batchSize));

  const addressesBlastedCount = result?.summary.totalRecipients ?? validRecipientCount;
  const recipientsSelectedCount = validRecipientCount;
  const addressesBlastedPct =
    recipientsSelectedCount > 0 ? Math.min(100, Math.round((addressesBlastedCount / recipientsSelectedCount) * 100)) : 0;
  const isDone = !!dropReceipt && !sending && !building;
  const screenTitle = isDone ? 'Blasting Done' : 'Blasting…';

  async function onStartSend() {
    setError(null);
    setResult(null);
    setReceipts([]);
    setDropReceipt(null);
    setExpanded(null);
    setBatchesPage(0);

    if (!state.walletPublicKey || !state.walletMode) {
      setError('Wallet not ready');
      return;
    }
    if (state.walletMode === 'built_in' && state.builtInWalletStatus !== 'unlocked') {
      setError('Built-in wallet is locked');
      return;
    }
    if (!state.selectedAsset) {
      setError('No asset selected');
      return;
    }
    if (!isConfirmed) {
      setError('Safety check not confirmed');
      return;
    }

    setBuilding(true);
    let built: BuildResult;
    try {
      const connection = getConnection();
      const owner = new PublicKey(state.walletPublicKey);

      const amountConfig = {
        mode: state.sendConfig.amountMode,
        equalAmountUi: state.sendConfig.equalAmountUi,
        equalNftCount: state.sendConfig.equalNftCount,
      };

      if (state.selectedAsset.kind === 'SOL') {
        built = await buildSolBatches(
          connection,
          owner,
          recipientsToUse,
          state.sendConfig.batchSize,
          amountConfig
        );
      } else if (state.selectedAsset.kind === 'NFT') {
        // Special Handling for NFTs via NftTransferService
        const items = (state.selectedAsset.groupItems || []) as DetectedNftItem[];
        const group: DetectedNftAsset = {
          groupId: state.selectedAsset.mint,
          groupName: state.selectedAsset.symbol || 'Unknown Collection',
          items: items,
          ownedCount: state.selectedAsset.ownedCount || 0,
          standard: state.selectedAsset.standard || 'standard_spl_nft',
          tokenProgram: state.selectedAsset.tokenProgram
        };

        const batches = await NftTransferService.buildTransferBatches(
          connection,
          owner,
          group,
          recipientsToUse,
          state.sendConfig.batchSize,
          amountConfig
        );
        
        // Map to BuiltBatch
        const builtBatches: BuiltBatch[] = batches.map((b, idx) => ({
          index: idx,
          tx: b.tx,
          recipients: b.recipients,
          kind: 'NFT'
        }));

        // Calculate total items
        let totalItems = 0;
        if (amountConfig.mode === 'equal') {
           totalItems = recipientsToUse.length * (amountConfig.equalNftCount || 1);
        } else {
           totalItems = recipientsToUse.reduce((acc, r) => acc + (parseInt(r.amount || '1') || 1), 0);
        }

        built = {
          batches: builtBatches,
          summary: {
            totalRecipients: recipientsToUse.length,
            totalAmountUi: totalItems.toString()
          }
        };
      } else {
        built = await buildSplBatches(
          connection,
          owner,
          recipientsToUse,
          new PublicKey(state.selectedAsset.mint),
          state.selectedAsset.decimals,
          state.sendConfig.batchSize,
          amountConfig,
          state.sendConfig.createRecipientAtaIfMissing
        );
      }
      
      if (built.summary.totalRecipients <= 0 || built.batches.length === 0) {
        throw new Error('No valid recipient amounts to send');
      }

      setResult(built);
      setBuilding(false);

      const now = Date.now();
      const sentRecipients = built.batches
        .flatMap((b) => b.recipients)
        .map((r) => ({ id: r.id, address: r.address, amount: r.amount }));
      const uniq = new Map<string, { id: string; address: string; amount?: string }>();
      for (const r of sentRecipients) uniq.set(r.id, r);
      const actualRecipientCount = uniq.size;

      const receipt: DropReceipt = {
        id: String(now) + '-' + Math.random().toString(36).slice(2, 8),
        createdAt: now,
        network: getNetwork(),
        walletPublicKey: state.walletPublicKey,
        asset: state.selectedAsset,
        recipientCount: actualRecipientCount,
        validRecipientCount: actualRecipientCount,
        totalAmountUi: built.summary.totalAmountUi,
        recipients: Array.from(uniq.values()),
        fee: {
          feeMint: route.params?.feeTokenMint || state.feeTokenMint,
          feeTokens: route.params?.feeAmountUi || state.feeQuote?.feeTokens || '0',
          discounted: !!(state.seekerDiscountEnabled && state.solanaMobileOwner),
        },
        batchSize: state.sendConfig.batchSize,
        batches: [],
        status: 'pending',
      };
      setDropReceipt(receipt);
      await StorageService.saveReceipt(receipt);

      setSending(true);
      const conn = getConnection();
      const out: BatchReceipt[] = [];
      for (let i = 0; i < built.batches.length; i++) {
        const batch = built.batches[i];
        const startedAt = Date.now();
        let br: BatchReceipt;
        try {
          const latest = await conn.getLatestBlockhash();
          batch.tx.recentBlockhash = latest.blockhash;
          batch.tx.feePayer = new PublicKey(state.walletPublicKey);
          await signTransaction(batch.tx);
          const raw = batch.tx.serialize();
          const signature = await conn.sendRawTransaction(raw);
          await conn.confirmTransaction(
            {
              signature,
              blockhash: latest.blockhash,
              lastValidBlockHeight: latest.lastValidBlockHeight,
            },
            'confirmed'
          );
          br = {
            batchIndex: batch.index,
            ok: true,
            signature,
            startedAt,
            finishedAt: Date.now(),
            recipientIds: batch.recipients.map((r) => r.id),
          };
        } catch (e: any) {
          br = {
            batchIndex: batch.index,
            ok: false,
            error: e?.message || 'Send failed',
            startedAt,
            finishedAt: Date.now(),
            recipientIds: batch.recipients.map((r) => r.id),
          };
        }
        out.push(br);
        const next = { ...receipt, batches: [...out] };
        const okCount = next.batches.filter((b) => b.ok).length;
        const failCount = next.batches.filter((b) => !b.ok).length;
        next.status = failCount === 0 && okCount === built.batches.length ? 'success' : okCount > 0 && failCount > 0 ? 'partial' : 'failed';
        setReceipts([...out]);
        setDropReceipt(next);
        await StorageService.updateReceipt(next);

        if (br.ok) {
          await hapticImpactLight();
        }
      }
      const okCount = out.filter((b) => b.ok).length;
      const failCount = out.filter((b) => !b.ok).length;
      await notify('BulkBlast finished', `${okCount} succeeded, ${failCount} failed`);
      if (failCount === 0) await hapticNotifySuccess();
      else if (okCount > 0) await hapticNotifyWarning();
      else await hapticNotifyError();

    } catch (e: any) {
      setError(e?.message || 'Execution failed');
      setBuilding(false);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (isConfirmed && !sending && !building && !result && !error) {
      onStartSend();
    }
  }, [isConfirmed]);

  if (!isConfirmed) {
     return (
       <Screen title="Access Denied" subtitle="Safety check required">
         <Card>
           <Text style={[styles.status, { color: colors.danger, textAlign: 'center' }]}>
             Transaction must be simulated and confirmed before execution.
           </Text>
           <Button title="Go Back" onPress={() => navigation.goBack()} variant="secondary" />
         </Card>
       </Screen>
     );
  }

  return (
    <Screen title={screenTitle} subtitle={result ? `Batch ${Math.min(receipts.length + (sending ? 1 : 0), result.batches.length)} of ${result.batches.length}` : 'Preparing'}>
      <Card>
        <Text style={styles.header}>Progress</Text>
        <Text style={styles.status}>
          {building ? 'Building transactions…' : sending ? `Sending ${result?.batches.length ?? estimatedBatchCount} batch(es)…` : dropReceipt ? 'Completed' : `Ready to send ${estimatedBatchCount} batch(es)`}
        </Text>
        <Row label="Recipients selected" value={recipientsSelectedCount.toString()} />
        <Row label="Addresses blasted" value={addressesBlastedCount.toString()} />
        {state.selectedAsset?.kind === 'SPL' && !state.sendConfig.createRecipientAtaIfMissing && result ? (
          <Row
            label="Skipped (missing ATA)"
            value={Math.max(0, recipientsSelectedCount - addressesBlastedCount).toString()}
          />
        ) : null}
        <View style={{ marginTop: 6 }}>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${addressesBlastedPct}%`,
                  backgroundColor: colors.success,
                },
              ]}
            />
          </View>
        </View>
        <Divider />
        <View style={{ marginTop: spacing[2] }} />
        <View style={styles.progressBar}>
          <View
            style={[
              styles.progressFill,
              {
                width:
                  result && result.batches.length > 0
                    ? `${Math.min(100, Math.round(((receipts.length + (sending ? 0 : 0)) / result.batches.length) * 100))}%`
                    : '0%',
              },
            ]}
          />
        </View>
      </Card>

      {error ? (
        <Card>
          <Text style={[styles.status, { color: colors.danger }]}>{error}</Text>
          <Button title="Retry" onPress={onStartSend} variant="secondary" style={{ marginTop: spacing[2] }} />
        </Card>
      ) : null}

      {result ? (
        <Card>
          <Text style={styles.header}>Batches</Text>
          {result.batches.length > BATCHES_PAGE_SIZE ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] }}>
              <Button
                title="Prev"
                onPress={() => setBatchesPage((p) => Math.max(0, p - 1))}
                variant="secondary"
                disabled={batchesPage <= 0}
                style={{ flex: 1 }}
              />
              <Text style={{ color: colors.textSecondary, fontSize: 12, paddingHorizontal: spacing[2] }}>
                Page {batchesPage + 1} / {Math.max(1, Math.ceil(result.batches.length / BATCHES_PAGE_SIZE))}
              </Text>
              <Button
                title="Next"
                onPress={() => setBatchesPage((p) => Math.min(Math.max(0, Math.ceil(result.batches.length / BATCHES_PAGE_SIZE) - 1), p + 1))}
                variant="secondary"
                disabled={batchesPage >= Math.ceil(result.batches.length / BATCHES_PAGE_SIZE) - 1}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 260 }}>
            {result.batches
              .slice(batchesPage * BATCHES_PAGE_SIZE, (batchesPage + 1) * BATCHES_PAGE_SIZE)
              .map((b) => {
              const r = receipts.find((x) => x.batchIndex === b.index);
              const ok = r?.ok;
              const sig = r?.signature;
              const err = r?.error;
              return (
                <View key={b.index} style={{ paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: colors.surface2 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={styles.status}>Batch #{b.index + 1}</Text>
                    <Text style={[styles.status, ok ? styles.pillSuccess : styles.pillFailed]}>{ok === undefined ? 'Pending' : ok ? 'Success' : 'Failed'}</Text>
                  </View>
                  {sig ? <Text style={styles.sigText}>{shortSig(sig)}</Text> : null}
                  {!ok ? (
                    <Pressable onPress={() => setExpanded(expanded === b.index ? null : b.index)}>
                      <Text style={[styles.sigText, { textDecorationLine: 'underline', color: colors.primary }]}>Details</Text>
                    </Pressable>
                  ) : null}
                  {expanded === b.index && err ? <Text style={styles.detailsText}>{err}</Text> : null}
                </View>
              );
            })}
          </ScrollView>
        </Card>
      ) : null}

      {!sending && !building && !error && !dropReceipt && (
        <Button
          title="Start Send"
          onPress={onStartSend}
        />
      )}

      {dropReceipt && (
        <Card>
          <Text style={styles.header}>Summary</Text>
          <Row label="Success" value={receipts.filter((r) => r.ok).length.toString()} />
          <Row label="Failed" value={receipts.filter((r) => !r.ok).length.toString()} />
          <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] }}>
            <Button title="View Receipt" onPress={() => navigation.navigate('ReceiptDetails', { id: dropReceipt.id })} />
            <Button title="Back to Home" onPress={onFinish} variant="secondary" />
          </View>
          {(dropReceipt.status === 'failed' || dropReceipt.status === 'partial') && result && (
            <Button
              title="Retry failed only"
              onPress={() => {
                const failedIds = result.batches
                  .filter((b) => !receipts.find((r) => r.batchIndex === b.index)?.ok)
                  .flatMap((b) => b.recipients.map((x) => x.id));
                navigation.replace('ExecuteProgress', {
                  confirmed: true,
                  failedRecipientIds: failedIds,
                  feeTokenMint: route.params?.feeTokenMint,
                  feeTokenSymbol: route.params?.feeTokenSymbol,
                  feeAmountUi: route.params?.feeAmountUi,
                });
              }}
              variant="outline"
              style={{ marginTop: spacing[2] }}
            />
          )}
        </Card>
      )}
    </Screen>
  );
}
