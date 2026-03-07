import React, { useEffect, useState, useMemo } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Alert, Switch, ScrollView, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PublicKey } from '@solana/web3.js';

import type { CreateDropStackParamList } from '../../navigation/types';
import { Button, Card, Divider, Row, Screen } from '../../components/ui';
import { spacing, typography, useTheme } from '../../theme';
import { useApp } from '../../state/context';
import { FeeService } from '../../services/FeeService';
import { payFeeInSplToken, getSplBalance, getConnection } from '../../services/SolanaService';
import { buildSolBatches, buildSplBatches, BuiltBatch } from '../../services/TransactionService';
import { simulateBatches, SimulationResult } from '../../services/SimulationService';
import { ConfirmSendModal } from '../../components/modals/ConfirmSendModal';
import { NftTransferService } from '../../services/NftTransferService';
import { DetectedNftAsset, DetectedNftItem } from '../../types/nft';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'Review'>;

import { computeTotalToSend } from '../../utils/amounts';

import { getNetwork } from '../../services/SolanaService';

export function Review({ navigation }: Props) {
  const { state, dispatch } = useApp();
  const { colors } = useTheme();
  const { selectedAsset, assetBalance, feeQuote, sendConfig } = state;

  const isMainnet = getNetwork() === 'mainnet-beta';

  const recipientsToUse = useMemo(() => {
    // If giveaway enabled, filter by winners. 
    // BUT we must also apply the amount mode logic (equal vs per-recipient) to the *result*?
    // Actually, state.recipients stores the base list. 
    // computeTotalToSend handles the "equal" override logic.
    let list = state.recipients;
    if (state.giveawayConfig.enabled) {
      list = state.recipients.filter((r) => state.giveawayConfig.selectedRecipientIds.includes(r.id));
    }
    return list;
  }, [state.recipients, state.giveawayConfig]);

  const validRecipients = recipientsToUse.filter((r) => r.isValid).length;
  const totalRecipients = recipientsToUse.length;

  // Calculate total based on mode
  const totalToSendUi = useMemo(() => {
    return computeTotalToSend(
      recipientsToUse,
      sendConfig.amountMode,
      sendConfig.equalAmountUi,
      sendConfig.equalNftCount,
      selectedAsset
    );
  }, [recipientsToUse, sendConfig, selectedAsset]);

  const [payingFee, setPayingFee] = useState(false);
  const [feePaid, setFeePaid] = useState(false);
  const [seekerBalance, setSeekerBalance] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // Simulation & Safety
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [builtBatches, setBuiltBatches] = useState<BuiltBatch[]>([]);
  const [calculatedTotalUi, setCalculatedTotalUi] = useState<string>('0');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // 1. Calculate Fee Quote
  useEffect(() => {
    const count = recipientsToUse.filter((r) => r.isValid).length;
    const baseFeeUsd = FeeService.computeFeeUsd(count);
    const finalFeeUsd = FeeService.applyDiscount(baseFeeUsd, state.seekerDiscountEnabled && state.solanaMobileOwner);

    FeeService.getFeeInSeekerTokens(finalFeeUsd, state.feeTokenMint).then(({ feeTokens, rateUsdPerToken }) => {
      dispatch({
        type: 'fee/setQuote',
        quote: {
          recipientCount: count,
          feeUsd: baseFeeUsd.toFixed(2),
          discountedFeeUsd: finalFeeUsd.toFixed(2),
          feeTokens,
          rateUsdPerToken,
        },
      });
    });
  }, [recipientsToUse, state.seekerDiscountEnabled, state.solanaMobileOwner, state.feeTokenMint, dispatch]);

  // 2. Fetch SEEKER Balance
  useEffect(() => {
    if (state.walletPublicKey && state.feeTokenMint) {
      setLoadingBalance(true);
      getSplBalance(state.walletPublicKey, state.feeTokenMint)
        .then(setSeekerBalance)
        .catch(() => setSeekerBalance('0'))
        .finally(() => setLoadingBalance(false));
    }
  }, [state.walletPublicKey, state.feeTokenMint]);

  // 3. Clear simulation when recipients change
  useEffect(() => {
    setSimulationResult(null);
    setBuiltBatches([]);
    setCalculatedTotalUi('0');
  }, [recipientsToUse, state.sendConfig.batchSize, selectedAsset]);

  // 4. Auto-Run Safety Check
  useEffect(() => {
    if (state.walletPublicKey && selectedAsset && !simulating && !simulationResult) {
       onRunSafetyCheck();
    }
  }, [state.walletPublicKey, selectedAsset]);

  function onSwap() {
    navigation.navigate('SwapModal');
  }

  const hasInsufficientSeeker = seekerBalance && feeQuote && parseFloat(seekerBalance) < parseFloat(feeQuote.feeTokens);

  async function onPayFee() {
    if (!feeQuote || !state.walletPublicKey || !state.walletMode) return;

    setPayingFee(true);
    try {
      const signature = await payFeeInSplToken({
        ownerPubkey: state.walletPublicKey,
        payerSignerMode: state.walletMode,
        feeMint: state.feeTokenMint,
        feeAmountUi: feeQuote.feeTokens,
        treasuryAddress: state.treasuryAddress,
      });
      
      Alert.alert('Fee Paid Successfully', `Signature: ${shortAddress(signature)}`);
      setFeePaid(true);
      // Automatically proceed or let user click? Let user click "Proceed" to be safe.
    } catch (e: any) {
      Alert.alert('Fee Payment Failed', e.message || 'Unknown error');
    } finally {
      setPayingFee(false);
    }
  }

  async function onRunSafetyCheck() {
    if (!state.walletPublicKey || !selectedAsset) return;
    
    setSimulating(true);
    setSimulationResult(null);
    
    try {
      // 0. Check Wallet Balance (Fee Payer Existence)
      const connection = getConnection();
      const owner = new PublicKey(state.walletPublicKey);
      const balance = await connection.getBalance(owner);
      if (balance === 0) {
        throw new Error(
          'Your wallet has 0 SOL on this network. You need SOL to pay for transaction fees. Please request an airdrop (if on Devnet) or fund your wallet.'
        );
      }

      // 1. Check Recipient Cap
      if (validRecipients > sendConfig.maxRecipients) {
        throw new Error(`Recipient count (${validRecipients}) exceeds safety cap of ${sendConfig.maxRecipients}.`);
      }

      // 2. Build Batches
      let result;

      const amountConfig = {
        mode: sendConfig.amountMode,
        equalAmountUi: sendConfig.equalAmountUi,
        equalNftCount: sendConfig.equalNftCount,
      };

      if (selectedAsset.kind === 'SOL') {
        result = await buildSolBatches(
          connection,
          owner,
          recipientsToUse,
          sendConfig.batchSize,
          amountConfig
        );
      } else if (selectedAsset.kind === 'NFT') {
        // Construct minimal DetectedNftAsset for transfer
        const items = (selectedAsset.groupItems || []) as DetectedNftItem[];
        const group: DetectedNftAsset = {
          groupId: selectedAsset.mint,
          groupName: selectedAsset.symbol || 'Unknown Collection',
          items: items,
          ownedCount: selectedAsset.ownedCount || 0,
          standard: selectedAsset.standard || 'standard_spl_nft',
          tokenProgram: selectedAsset.tokenProgram
        };

        const batches = await NftTransferService.buildTransferBatches(
          connection,
          owner,
          group,
          recipientsToUse,
          sendConfig.batchSize,
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

        result = {
          batches: builtBatches,
          summary: {
            totalRecipients: recipientsToUse.length,
            totalAmountUi: totalItems.toString()
          }
        };
      } else {
        // SPL
        result = await buildSplBatches(
          connection,
          owner,
          recipientsToUse,
          new PublicKey(selectedAsset.mint),
          selectedAsset.decimals,
          sendConfig.batchSize,
          amountConfig,
          sendConfig.createRecipientAtaIfMissing
        );
      }

      setBuiltBatches(result.batches);
      setCalculatedTotalUi(result.summary.totalAmountUi);

      // 3. Check SOL Cap
      if (selectedAsset.kind === 'SOL') {
        const total = parseFloat(result.summary.totalAmountUi);
        const max = parseFloat(sendConfig.maxTotalSolUi);
        if (total > max) {
          throw new Error(`Total SOL (${total}) exceeds safety cap of ${max}. Adjust in Settings.`);
        }
      } else if (selectedAsset.kind === 'NFT' || (selectedAsset.kind === 'SPL' && selectedAsset.decimals === 0)) {
         // NFT Cap check: ensure total <= balance
         // assetBalance.amountUi is the holding
         const total = parseInt(result.summary.totalAmountUi);
         const balance = parseInt(assetBalance?.amountUi || '0');
         if (total > balance) {
           throw new Error(`Total NFTs required (${total}) exceeds your balance (${balance}).`);
         }
      }

      // 4. Run Simulation
      const simRes = await simulateBatches({
        connection,
        batches: result.batches,
        feePayerPubkey: owner,
      });

      setSimulationResult(simRes);

      if (!simRes.ok) {
        Alert.alert('Simulation Failed', `Failed batches: ${simRes.summary.failedBatches}. Check details below.`);
      }

    } catch (e: any) {
      Alert.alert('Safety Check Failed', e.message);
    } finally {
      setSimulating(false);
    }
  }

  function onProceedToConfirm() {
    setShowConfirmModal(true);
  }

  function onFinalConfirm() {
    setShowConfirmModal(false);
    navigation.navigate('ExecuteProgress', { confirmed: true });
  }

  function shortAddress(address: string) {
    if (address.length <= 12) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  const styles = useMemo(() => StyleSheet.create({
    sectionHeader: {
      fontSize: typography.fontSize.title,
      lineHeight: typography.lineHeight.title,
      fontWeight: typography.weight.semibold,
      color: colors.text,
      marginBottom: spacing[2],
    },
    feeAction: {
      marginTop: spacing[4],
      padding: spacing[3],
      backgroundColor: colors.surface2,
      borderRadius: 8,
      gap: spacing[3],
      alignItems: 'center',
    },
    feeNote: {
      fontSize: typography.fontSize.caption,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: spacing[2],
    },
    swapBtn: {
      height: 40,
      marginTop: spacing[2],
    },
    errorText: {
      color: colors.danger,
    },
    balanceContainer: {
      marginTop: spacing[2],
      alignItems: 'flex-end',
    },
    balanceText: {
      fontSize: typography.fontSize.caption,
      color: colors.textSecondary,
    },
    simulationBox: {
      marginTop: spacing[4],
      padding: spacing[3],
      borderRadius: 8,
      backgroundColor: colors.surface2,
    },
    simSuccess: {
      color: colors.success,
      fontWeight: 'bold',
      marginBottom: spacing[2],
    },
    simError: {
      color: colors.danger,
      fontWeight: 'bold',
      marginBottom: spacing[2],
    },
    logText: {
      fontSize: 10,
      fontFamily: 'monospace',
      color: colors.textSecondary,
    }
  }), [colors]);

  return (
    <Screen title="Review Drop" subtitle="Check details before executing">
      <ScrollView contentContainerStyle={{ gap: spacing[4], paddingBottom: spacing[6] }}>
        <Card>
          <Text style={styles.sectionHeader}>Asset Details</Text>
          {selectedAsset?.kind === 'SOL' ? (
            <>
              <Row label="Asset" value="Solana (SOL)" />
              <Row label="Balance" value={`${assetBalance?.amountUi ?? '0'} SOL`} />
            </>
          ) : selectedAsset?.kind === 'SPL' ? (
            <>
              <Row label="Asset" value={`SPL Token ${selectedAsset.symbol ? `(${selectedAsset.symbol})` : ''}`} />
              <Row label="Mint" value={shortAddress(selectedAsset.mint)} />
              <Row label="Decimals" value={selectedAsset.decimals.toString()} />
              <Row label="Balance" value={`${assetBalance?.amountUi ?? '0'} ${selectedAsset.symbol || ''}`} />
            </>
          ) : selectedAsset?.kind === 'NFT' ? (
            <>
              <Row label="Collection" value={selectedAsset.symbol || 'Unknown'} />
              <Row label="Group ID" value={shortAddress(selectedAsset.mint)} />
              <Row label="Owned Items" value={selectedAsset.ownedCount?.toString() || '0'} />
            </>
          ) : (
            <Text style={styles.errorText}>No asset selected</Text>
          )}
        </Card>

        <Card>
          <Text style={styles.sectionHeader}>Drop Summary</Text>
          <Row label="Recipients" value={`${validRecipients} valid / ${totalRecipients} total`} />
          
          {state.giveawayConfig.enabled && (
             <Text style={{ fontSize: typography.fontSize.caption, color: colors.primary, marginTop: spacing[1], marginBottom: spacing[2], textAlign: 'right' }}>
               🎁 Giveaway Mode Active
             </Text>
          )}

          <Divider />
          
          <Row label="Mode" value={sendConfig.amountMode === 'equal' ? 'Equal Amount' : 'Per-Recipient'} />
          
          {sendConfig.amountMode === 'equal' && (
             <Row 
               label="Per Recipient" 
               value={
                 selectedAsset?.kind === 'NFT' 
                   ? `${sendConfig.equalNftCount} NFT(s)` 
                   : `${sendConfig.equalAmountUi} ${selectedAsset?.kind === 'SOL' ? 'SOL' : (selectedAsset?.kind === 'SPL' ? selectedAsset.symbol : 'Tokens')}`
               } 
             />
          )}
          
          <Row label="Total Required" value={`${totalToSendUi} ${selectedAsset?.kind === 'NFT' ? 'Items' : (selectedAsset?.kind === 'SOL' ? 'SOL' : selectedAsset?.symbol || 'Tokens')}`} />
        </Card>

        <Card>
          <Text style={styles.sectionHeader}>Batching</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3] }}>
            <Text style={{ color: colors.textSecondary, fontSize: typography.fontSize.body }}>Batch size</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
              <Button
                title="-"
                variant="secondary"
                onPress={() => dispatch({ type: 'sendConfig/setBatchSize', batchSize: state.sendConfig.batchSize - 1 })}
                disabled={state.sendConfig.batchSize <= 1}
                style={{ minHeight: 40, paddingHorizontal: spacing[3], borderRadius: 10 }}
              />
              <Text style={{ color: colors.text, fontSize: typography.fontSize.body, minWidth: 24, textAlign: 'center' }}>
                {state.sendConfig.batchSize}
              </Text>
              <Button
                title="+"
                variant="secondary"
                onPress={() => dispatch({ type: 'sendConfig/setBatchSize', batchSize: state.sendConfig.batchSize + 1 })}
                disabled={state.sendConfig.batchSize >= 20}
                style={{ minHeight: 40, paddingHorizontal: spacing[3], borderRadius: 10 }}
              />
            </View>
          </View>

          <Text style={{ color: colors.textSecondary, fontSize: typography.fontSize.caption, textAlign: 'right', marginTop: -spacing[2] }}>
            {Math.ceil(validRecipients / Math.max(1, state.sendConfig.batchSize))} transaction(s) total
          </Text>

          {selectedAsset?.kind === 'SPL' ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3] }}>
              <Text style={{ color: colors.textSecondary, fontSize: typography.fontSize.body }}>Auto-create recipient token accounts</Text>
              <Switch
                value={state.sendConfig.createRecipientAtaIfMissing}
                onValueChange={() => dispatch({ type: 'sendConfig/toggleCreateAta' })}
                trackColor={{ false: colors.surface2, true: colors.primary }}
              />
            </View>
          ) : null}
        </Card>

        {/* Simulation Results (Optional) */}
        {simulating ? (
           <Card>
             <Text style={styles.sectionHeader}>Safety Check</Text>
             <ActivityIndicator color={colors.primary} />
             <Text style={{ textAlign: 'center', marginTop: spacing[2], color: colors.textSecondary }}>Simulating transactions...</Text>
           </Card>
        ) : simulationResult ? (
          <View style={styles.simulationBox}>
            <Text style={styles.sectionHeader}>Safety Check Results</Text>
            {simulationResult.ok ? (
              <Text style={styles.simSuccess}>✅ All {simulationResult.summary.totalBatches} batches passed checks.</Text>
            ) : (
              <>
                <Text style={styles.simError}>⚠️ Simulation Failed: {simulationResult.summary.failedBatches} batches failed.</Text>
                <Text style={{ color: colors.textSecondary, marginBottom: 8, fontSize: 12 }}>
                  You can retry or proceed at your own risk.
                </Text>
                <Button 
                   title="Retry Safety Check" 
                   onPress={onRunSafetyCheck} 
                   variant="outline" 
                   style={{ marginBottom: spacing[2] }}
                />
              </>
            )}

            <Pressable onPress={() => setShowLogs(!showLogs)} style={{ paddingVertical: spacing[2] }}>
              <Text style={{ color: colors.primary, textDecorationLine: 'underline' }}>
                {showLogs ? 'Hide Technical Details' : 'Show Technical Details'}
              </Text>
            </Pressable>

            {showLogs && (
              <View style={{ marginTop: spacing[2], maxHeight: 200, backgroundColor: colors.background, padding: spacing[2], borderRadius: 4 }}>
                <ScrollView nestedScrollEnabled>
                  {simulationResult.results.map((r, i) => (
                    <View key={i} style={{ marginBottom: spacing[2] }}>
                      <Text style={{ fontWeight: 'bold', color: r.ok ? colors.success : colors.danger }}>
                        Batch #{r.batchIndex + 1}: {r.ok ? 'Success' : 'Failed'}
                      </Text>
                      {!r.ok && <Text style={{ color: colors.danger, fontSize: 11 }}>Error: {r.error}</Text>}
                      {r.logs && r.logs.length > 0 && (
                        <Text style={styles.logText}>{r.logs.join('\n')}</Text>
                      )}
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        ) : null}

        {/* Fees & Execution - ALWAYS SHOWN NOW */}
        <Card>
          <Text style={styles.sectionHeader}>Fees & Execution</Text>
          
          {/* Fee Section (Mainnet Only) */}
          {isMainnet ? (
            !feePaid ? (
              <>
                 {!feeQuote ? (
                   <ActivityIndicator size="small" color={colors.primary} />
                 ) : (
                   <View>
                      <Row label="Fee Amount" value={`${feeQuote.feeTokens} SEEKER`} valueStyle={{ fontWeight: 'bold', color: colors.primary }} />
                      <Row label="Your Balance" value={loadingBalance ? '...' : `${seekerBalance || '0'} SEEKER`} />
                      
                      {state.seekerDiscountEnabled && (
                         <Text style={{ color: colors.success, fontSize: 12, marginTop: 4 }}>Discount applied (50% OFF)</Text>
                      )}
                      
                      {hasInsufficientSeeker && (
                         <View style={{ marginTop: spacing[2], padding: spacing[2], backgroundColor: colors.danger + '20', borderRadius: 4 }}>
                            <Text style={{ color: colors.danger, fontSize: 12, marginBottom: spacing[2] }}>Insufficient SEEKER balance.</Text>
                            <Button 
                              title="Swap SOL → SEEKER" 
                              onPress={onSwap} 
                              variant="secondary" 
                              style={{ height: 32 }}
                            />
                         </View>
                      )}

                      <Button
                         title={payingFee ? 'Processing Payment...' : 'Pay Fee (SEEKER)'}
                         onPress={onPayFee}
                         variant="primary"
                         disabled={payingFee || !!hasInsufficientSeeker}
                         style={{ marginTop: spacing[4] }}
                      />
                   </View>
                 )}
              </>
            ) : (
              <View style={{ alignItems: 'center', padding: spacing[3] }}>
                 <Text style={{ fontSize: 24, marginBottom: spacing[2] }}>✅</Text>
                 <Text style={{ color: colors.success, fontWeight: 'bold', marginBottom: spacing[2] }}>Fee Paid</Text>
                 <Button 
                   title="Proceed to Execute Drop" 
                   onPress={onProceedToConfirm} 
                   variant="primary" 
                   style={{ width: '100%' }}
                 />
              </View>
            )
          ) : (
            // Devnet
            <View>
               <Text style={{ color: colors.success, fontStyle: 'italic', marginBottom: spacing[3] }}>Fees are waived on Devnet.</Text>
               <Button 
                 title="Proceed to Execute Drop" 
                 onPress={onProceedToConfirm} 
                 variant="primary" 
               />
            </View>
          )}
        </Card>
      </ScrollView>

      <ConfirmSendModal
        visible={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={onFinalConfirm}
        recipientsCount={validRecipients}
        totalAmountUi={calculatedTotalUi}
        asset={selectedAsset}
        batchesCount={builtBatches.length}
        feeQuote={feeQuote}
      />
    </Screen>
  );
}
