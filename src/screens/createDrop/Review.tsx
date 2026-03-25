import React, { useEffect, useState, useMemo, useRef } from 'react';
import { StyleSheet, Text, View, ActivityIndicator, Alert, Switch, ScrollView, Pressable } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import type { CreateDropStackParamList } from '../../navigation/types';
import { Button, Card, Divider, Row, Screen } from '../../components/ui';
import { spacing, typography, useTheme } from '../../theme';
import { useApp } from '../../state/context';
import { FeeService } from '../../services/FeeService';
import { payFeeInSplToken, getSplBalance, getConnection, getSolBalance, sendSol } from '../../services/SolanaService';
import { buildSolBatches, buildSplBatches, BuiltBatch } from '../../services/TransactionService';
import { simulateBatches, SimulationResult } from '../../services/SimulationService';
import { ConfirmSendModal } from '../../components/modals/ConfirmSendModal';
import { NftTransferService } from '../../services/NftTransferService';
import { DetectedNftAsset, DetectedNftItem } from '../../types/nft';
import { TOKENS } from '../../config/tokens';
import { StorageService } from '../../services/StorageService';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'Review'>;

import { computeTotalToSend } from '../../utils/amounts';

import { getNetwork } from '../../services/SolanaService';

/** Stops the auto safety-check effect from re-firing in a loop when a pre-sim check throws. */
function makePrecheckFailureResult(message: string): SimulationResult {
  return {
    ok: false,
    results: [{ batchIndex: 0, ok: false, error: message }],
    summary: { totalBatches: 1, failedBatches: 1 },
  };
}

export function Review({ navigation }: Props) {
  const { state, dispatch } = useApp();
  const { colors } = useTheme();
  const { selectedAsset, assetBalance, feeQuote, sendConfig } = state;

  const isMainnet = getNetwork() === 'mainnet-beta';
  const lastReviewBlurAtRef = useRef<number | null>(null);

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
  const [effectiveValidRecipients, setEffectiveValidRecipients] = useState<number>(validRecipients);
  const [recipientAtaSkipped, setRecipientAtaSkipped] = useState<number>(0);

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
  const defaultPaymentToken: 'SKR' | 'SOL' = state.feeTokenMint === TOKENS.SOL.mint ? 'SOL' : 'SKR';
  const [paymentToken, setPaymentToken] = useState<'SKR' | 'SOL'>(defaultPaymentToken);
  const [seekerBalance, setSeekerBalance] = useState<string | null>(null);
  const [solBalanceUi, setSolBalanceUi] = useState<string | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  // Simulation & Safety
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [builtBatches, setBuiltBatches] = useState<BuiltBatch[]>([]);
  const [calculatedTotalUi, setCalculatedTotalUi] = useState<string>('0');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const feeWaivedByLaunchPromo = isMainnet && state.launchBlastFreeFeeAvailable;

  // 1. Calculate Fee Quote
  useEffect(() => {
    const count = effectiveValidRecipients;
    const baseFeeUsd = feeWaivedByLaunchPromo ? 0 : FeeService.computeFeeUsdByToken(count, paymentToken);
    const shouldDiscount = state.seekerDiscountEnabled && state.solanaMobileOwner;
    const finalFeeUsd = feeWaivedByLaunchPromo ? 0 : FeeService.applyDiscount(baseFeeUsd, shouldDiscount);
    const feeMint = paymentToken === 'SOL' ? TOKENS.SOL.mint : TOKENS.SKR.mint;

    FeeService.getFeeInToken(finalFeeUsd, feeMint).then(({ feeAmountUi, rateUsdPerToken }) => {
      dispatch({
        type: 'fee/setQuote',
        quote: {
          recipientCount: count,
          feeUsd: baseFeeUsd.toFixed(2),
          discountedFeeUsd: finalFeeUsd.toFixed(2),
          feeTokens: feeAmountUi,
          feeAmountUi,
          feeTokenSymbol: paymentToken,
          rateUsdPerToken,
        },
      });
    });
  }, [effectiveValidRecipients, state.seekerDiscountEnabled, state.solanaMobileOwner, paymentToken, dispatch, feeWaivedByLaunchPromo]);

  // 2. Fetch fee-token balances
  useEffect(() => {
    if (state.walletPublicKey && state.feeTokenMint) {
      setLoadingBalance(true);
      Promise.all([
        getSplBalance(state.walletPublicKey, TOKENS.SKR.mint).catch(() => '0'),
        getSolBalance(state.walletPublicKey).then((b) => b.ui).catch(() => '0'),
      ])
        .then(([skr, sol]) => {
          setSeekerBalance(skr);
          setSolBalanceUi(sol);
        })
        .finally(() => setLoadingBalance(false));
    }
  }, [state.walletPublicKey, state.feeTokenMint]);

  useEffect(() => {
    setPaymentToken(state.feeTokenMint === TOKENS.SOL.mint ? 'SOL' : 'SKR');
  }, [state.feeTokenMint]);

  // 3. Clear simulation when drop inputs change (including amounts — fixes stuck state after a failed check)
  useEffect(() => {
    setSimulationResult(null);
    setBuiltBatches([]);
    setCalculatedTotalUi('0');
    setEffectiveValidRecipients(validRecipients);
    setRecipientAtaSkipped(0);
  }, [
    recipientsToUse,
    state.sendConfig.batchSize,
    selectedAsset,
    sendConfig.createRecipientAtaIfMissing,
    sendConfig.amountMode,
    sendConfig.equalAmountUi,
    sendConfig.equalNftCount,
    validRecipients,
  ]);

  // If the user paid fees, proceeded to execute, then navigated back from ExecuteProgress,
  // we must require fee payment again to prevent "free re-runs".
  useEffect(() => {
    const unsubFocus = navigation.addListener('focus', async () => {
      if (!feePaid) return;
      if (!lastReviewBlurAtRef.current) return;
      if (!state.walletPublicKey || !selectedAsset) return;

      try {
        const receipts = await StorageService.listReceipts();
        const now = Date.now();
        const lastBlurAt = lastReviewBlurAtRef.current;
        const net = getNetwork();

        const relevant = receipts.find((r) => {
          if (r.status !== 'success' && r.status !== 'partial') return false;
          if (r.walletPublicKey !== state.walletPublicKey) return false;
          if (r.network !== net) return false;
          if (r.createdAt < lastBlurAt) return false;

          // Match on asset identity (SOL/SPL mint or NFT group id)
          if (r.asset.kind !== selectedAsset.kind) return false;
          if (r.asset.mint !== selectedAsset.mint) return false;
          return true;
        });

        if (relevant) {
          setFeePaid(false);
          setPaymentToken(defaultPaymentToken);
        }
      } catch {
        // If receipt lookup fails, don't lock the user out; just keep current state.
      } finally {
        // Prevent repeated checks on subsequent focuses.
        lastReviewBlurAtRef.current = null;
      }
    });

    const unsubBlur = navigation.addListener('blur', () => {
      lastReviewBlurAtRef.current = Date.now();
    });

    return () => {
      unsubFocus();
      unsubBlur();
    };
  }, [navigation, feePaid, selectedAsset, state.walletPublicKey, state.walletMode]);

  // 4. Auto-Run Safety Check (only when no result yet — failures must set simulationResult or this loops forever)
  useEffect(() => {
    if (state.walletPublicKey && selectedAsset && !simulating && !simulationResult) {
      onRunSafetyCheck();
    }
  }, [
    state.walletPublicKey,
    selectedAsset,
    recipientsToUse,
    state.sendConfig.batchSize,
    sendConfig.createRecipientAtaIfMissing,
    sendConfig.amountMode,
    sendConfig.equalAmountUi,
    sendConfig.equalNftCount,
    simulating,
    simulationResult,
  ]);

  function onSwap() {
    navigation.navigate('SwapModal');
  }

  const requiredFeeAmount = parseFloat(feeQuote?.feeAmountUi || feeQuote?.feeTokens || '0');
  const hasInsufficientSeeker =
    paymentToken === 'SKR' && !!feeQuote && parseFloat(seekerBalance || '0') < requiredFeeAmount;
  const hasInsufficientSol =
    paymentToken === 'SOL' && !!feeQuote && parseFloat(solBalanceUi || '0') < requiredFeeAmount;

  async function onPayFee() {
    if (!feeQuote || !state.walletPublicKey || !state.walletMode) return;

    setPayingFee(true);
    try {
      let signature = '';
      if (paymentToken === 'SOL') {
        signature = await sendSol({
          to: state.treasuryAddress,
          amountUi: feeQuote.feeAmountUi || feeQuote.feeTokens,
          from: state.walletPublicKey,
          walletMode: state.walletMode,
        });
      } else {
        signature = await payFeeInSplToken({
          ownerPubkey: state.walletPublicKey,
          payerSignerMode: state.walletMode,
          feeMint: TOKENS.SKR.mint,
          feeAmountUi: feeQuote.feeAmountUi || feeQuote.feeTokens,
          treasuryAddress: state.treasuryAddress,
        });
      }
      
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

      // 1. Pre-check balances + common SPL failure causes
      if (selectedAsset.kind === 'SOL') {
        const totalSolUi = parseFloat(totalToSendUi || '0');
        const totalLamports = Math.round(totalSolUi * LAMPORTS_PER_SOL);
        // Only enforce enough SOL for the amount; simulation will still catch any remaining issues.
        if (Number.isFinite(totalSolUi) && totalLamports > balance) {
          throw new Error(
            `Insufficient SOL for the amount to send. You have ${((balance || 0) / LAMPORTS_PER_SOL).toFixed(4)} SOL, but need ${totalSolUi.toString()} SOL.`
          );
        }
      }

      // SPL / NFT: early balance check (same user-facing pattern as SOL) when we can compute required total from inputs
      const sym = selectedAsset.kind === 'SPL' ? selectedAsset.symbol || 'token' : selectedAsset.kind === 'NFT' ? 'NFTs' : '';
      if (selectedAsset.kind === 'SPL' && selectedAsset.decimals > 0) {
        const needUi = parseFloat(computeTotalToSend(
          recipientsToUse,
          sendConfig.amountMode,
          sendConfig.equalAmountUi,
          sendConfig.equalNftCount,
          selectedAsset
        ) || '0');
        const haveUi = parseFloat(assetBalance?.amountUi || '0');
        if (Number.isFinite(needUi) && needUi > 0 && Number.isFinite(haveUi) && haveUi < needUi) {
          throw new Error(
            `Insufficient ${sym} for the amount to send. You have ${haveUi.toString()}, but need ${needUi.toString()}.`
          );
        }
      }
      if (selectedAsset.kind === 'NFT' || (selectedAsset.kind === 'SPL' && selectedAsset.decimals === 0)) {
        let requiredCount = 0;
        if (sendConfig.amountMode === 'equal') {
          requiredCount = recipientsToUse.length * (sendConfig.equalNftCount || 1);
        } else {
          requiredCount = recipientsToUse.reduce(
            (acc, r) => acc + (parseInt(r.amount || '1', 10) || 1),
            0
          );
        }
        const haveCount = parseInt(assetBalance?.amountUi || '0', 10) || 0;
        if (requiredCount > 0 && haveCount < requiredCount) {
          const unit = selectedAsset.kind === 'NFT' ? 'NFTs' : sym || 'tokens';
          throw new Error(
            `Insufficient ${unit} for the amount to send. You have ${haveCount}, but need ${requiredCount}.`
          );
        }
      }

      if (selectedAsset.kind === 'SPL') {
        // For SPL, the most common big-batch failure is missing recipient ATAs + not enough SOL rent.
        // We'll check only the first batch to give a clear error instead of a downstream Token program "InvalidAccountData".
        const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

        const validRecipientList = recipientsToUse.filter((r) => r.isValid);
        const firstBatchRecipients = validRecipientList.slice(0, Math.max(1, sendConfig.batchSize));
        if (firstBatchRecipients.length > 0) {
          const mintPk = new PublicKey(selectedAsset.mint);
          const recipientATAs = firstBatchRecipients.map((r) =>
            PublicKey.findProgramAddressSync(
              [new PublicKey(r.address).toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mintPk.toBuffer()],
              ASSOCIATED_TOKEN_PROGRAM_ID
            )[0]
          );

          const accounts = await connection.getMultipleAccountsInfo(recipientATAs);
          const missingCount = recipientATAs.filter((_, idx) => !accounts[idx]).length;

          if (missingCount > 0 && sendConfig.createRecipientAtaIfMissing) {
            // Token account size is 165 bytes for the standard SPL token account.
            const rentExemptLamports = await connection.getMinimumBalanceForRentExemption(165);
            const requiredLamportsForRent = BigInt(rentExemptLamports) * BigInt(missingCount);
            if (requiredLamportsForRent > BigInt(balance)) {
              const neededExtra = requiredLamportsForRent - BigInt(balance);
              throw new Error(
                `Insufficient SOL to create missing recipient ATAs.\n` +
                  `Need ~${(Number(requiredLamportsForRent) / LAMPORTS_PER_SOL).toFixed(4)} SOL rent for the first batch (missing: ${missingCount}), ` +
                  `but you only have ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL.\n` +
                  `Extra needed: ${(Number(neededExtra) / LAMPORTS_PER_SOL).toFixed(4)} SOL.`
              );
            }
          }
        }
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
      setEffectiveValidRecipients(result.summary.totalRecipients);
      if (selectedAsset.kind === 'SPL' && !sendConfig.createRecipientAtaIfMissing) {
        const skipped = validRecipients - result.summary.totalRecipients;
        setRecipientAtaSkipped(Math.max(0, skipped));
      } else {
        setRecipientAtaSkipped(0);
      }

      // SPL balance check should be based on what we will actually send (post-ATA filtering).
      if (selectedAsset.kind === 'SPL' && selectedAsset.decimals > 0) {
        const neededTokenUi = parseFloat(result.summary.totalAmountUi || '0');
        const haveTokenUi = parseFloat(assetBalance?.amountUi || '0');
        if (Number.isFinite(neededTokenUi) && Number.isFinite(haveTokenUi) && neededTokenUi > 0 && haveTokenUi < neededTokenUi) {
          throw new Error(
            `Insufficient ${selectedAsset.symbol || 'token'} for the amount to send. You have ${haveTokenUi.toString()}, but need ${neededTokenUi.toString()}.`
          );
        }
      }

      // 3. Extra NFT / 0-decimal SPL balance check (post-build totals; ATA filtering can reduce SPL count)
      if (selectedAsset.kind === 'NFT' || (selectedAsset.kind === 'SPL' && selectedAsset.decimals === 0)) {
        const total = parseInt(result.summary.totalAmountUi, 10);
        const balanceTokens = parseInt(assetBalance?.amountUi || '0', 10) || 0;
        if (Number.isFinite(total) && total > balanceTokens) {
          const unit = selectedAsset.kind === 'NFT' ? 'NFTs' : selectedAsset.symbol || 'tokens';
          throw new Error(
            `Insufficient ${unit} for the amount to send. You have ${balanceTokens}, but need ${total}.`
          );
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
      const msg = e?.message || 'Safety check failed';
      Alert.alert('Safety Check Failed', msg);
      setBuiltBatches([]);
      setCalculatedTotalUi('0');
      setEffectiveValidRecipients(validRecipients);
      setRecipientAtaSkipped(0);
      setSimulationResult(makePrecheckFailureResult(msg));
    } finally {
      setSimulating(false);
    }
  }

  function onProceedToConfirm() {
    setShowConfirmModal(true);
  }

  function onFinalConfirm() {
    setShowConfirmModal(false);
    if (feeWaivedByLaunchPromo) {
      // Consume one-time Launch & Blast promo after user confirms execution.
      dispatch({ type: 'promo/consumeLaunchBlastFreeFee' });
    }
    const feeTokenMintToUse = paymentToken === 'SOL' ? TOKENS.SOL.mint : TOKENS.SKR.mint;
    navigation.navigate('ExecuteProgress', {
      confirmed: true,
      feeTokenMint: feeTokenMintToUse,
      feeTokenSymbol: paymentToken,
      feeAmountUi: feeQuote?.feeAmountUi || feeQuote?.feeTokens || '0',
    });
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
          <Row
            label="Recipients"
            value={
              selectedAsset?.kind === 'SPL' && !sendConfig.createRecipientAtaIfMissing && recipientAtaSkipped > 0 && simulationResult
                ? `${effectiveValidRecipients} will receive / ${totalRecipients} total`
                : `${validRecipients} valid / ${totalRecipients} total`
            }
          />
          
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
          
          <Row
            label="Total Required"
            value={`${simulationResult ? calculatedTotalUi : totalToSendUi} ${
              selectedAsset?.kind === 'NFT'
                ? 'Items'
                : selectedAsset?.kind === 'SOL'
                  ? 'SOL'
                  : selectedAsset?.symbol || 'Tokens'
            }`}
          />
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
            <View style={{ paddingVertical: spacing[3] }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.textSecondary, fontSize: typography.fontSize.body }}>
                  Auto-create recipient token accounts
                </Text>
                <Switch
                  value={state.sendConfig.createRecipientAtaIfMissing}
                  onValueChange={() => dispatch({ type: 'sendConfig/toggleCreateAta' })}
                  trackColor={{ false: colors.surface2, true: colors.primary }}
                />
              </View>
              <Text
                style={{
                  color: colors.textSecondary,
                  fontStyle: 'italic',
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                {state.sendConfig.createRecipientAtaIfMissing
                  ? 'ON: we will create missing recipient token accounts (ATA).'
                  : 'OFF: only recipients who already have the ATA will be paid; missing ones are skipped.'}
              </Text>
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
            {recipientAtaSkipped > 0 && selectedAsset?.kind === 'SPL' && !sendConfig.createRecipientAtaIfMissing ? (
              <Text style={{ color: colors.warningText, marginBottom: spacing[2], textAlign: 'center' }}>
                Skipped {recipientAtaSkipped} recipient(s) that didn&apos;t have the token account (ATA) because auto-create is OFF.
              </Text>
            ) : null}
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
            feeWaivedByLaunchPromo ? (
              <View style={{ alignItems: 'center', padding: spacing[3] }}>
                <Text style={{ fontSize: 24, marginBottom: spacing[2] }}>🎉</Text>
                <Text style={{ color: colors.success, fontWeight: 'bold', marginBottom: spacing[2] }}>
                  Free Blast Fee Applied
                </Text>
                <Text style={{ color: colors.textSecondary, textAlign: 'center', marginBottom: spacing[3] }}>
                  You launched from Bags and tapped BLAST NOW, so this one bulk blast is free. This promo is one-time only.
                </Text>
                <Button
                  title="Proceed to Execute Drop"
                  onPress={onProceedToConfirm}
                  variant="primary"
                  style={{ width: '100%' }}
                />
              </View>
            ) : (
            !feePaid ? (
              <>
                 {!feeQuote ? (
                   <ActivityIndicator size="small" color={colors.primary} />
                 ) : (
                   <View>
                      <Text style={{ color: colors.textSecondary, marginBottom: spacing[2] }}>Choose Payment Token</Text>
                      <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] }}>
                        <Pressable
                          onPress={() => setPaymentToken('SKR')}
                          style={{
                            flex: 1,
                            borderRadius: 10,
                            borderWidth: 1.5,
                            borderColor: paymentToken === 'SKR' ? colors.primary : colors.border,
                            backgroundColor: paymentToken === 'SKR' ? colors.primary + '14' : colors.surface2,
                            padding: spacing[3],
                          }}
                        >
                          <Text style={{ color: paymentToken === 'SKR' ? colors.primary : colors.text, fontWeight: '700', textAlign: 'center' }}>SKR</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => setPaymentToken('SOL')}
                          style={{
                            flex: 1,
                            borderRadius: 10,
                            borderWidth: 1.5,
                            borderColor: paymentToken === 'SOL' ? colors.primary : colors.border,
                            backgroundColor: paymentToken === 'SOL' ? colors.primary + '14' : colors.surface2,
                            padding: spacing[3],
                          }}
                        >
                          <Text style={{ color: paymentToken === 'SOL' ? colors.primary : colors.text, fontWeight: '700', textAlign: 'center' }}>SOL</Text>
                        </Pressable>
                      </View>

                      <Row label="Fee Amount" value={`${feeQuote.feeAmountUi || feeQuote.feeTokens} ${paymentToken}`} valueStyle={{ fontWeight: 'bold', color: colors.primary }} />
                      <Row
                        label="Your Balance"
                        value={
                          loadingBalance
                            ? '...'
                            : paymentToken === 'SOL'
                            ? `${solBalanceUi || '0'} SOL`
                            : `${seekerBalance || '0'} SKR`
                        }
                      />
                      
                      {state.seekerDiscountEnabled && state.solanaMobileOwner && (
                         <Text style={{ color: colors.success, fontSize: 12, marginTop: 4 }}>
                           Solana Mobile discount applied (50% OFF)
                         </Text>
                      )}
                      
                      {hasInsufficientSeeker && (
                         <View style={{ marginTop: spacing[2], padding: spacing[2], backgroundColor: colors.danger + '20', borderRadius: 4 }}>
                            <Text style={{ color: colors.danger, fontSize: 12, marginBottom: spacing[2] }}>Insufficient SKR balance.</Text>
                            <Button 
                              title="Swap SOL → SKR" 
                              onPress={onSwap} 
                              variant="secondary" 
                              style={{ height: 32 }}
                            />
                         </View>
                      )}
                      {hasInsufficientSol && (
                         <View style={{ marginTop: spacing[2], padding: spacing[2], backgroundColor: colors.danger + '20', borderRadius: 4 }}>
                           <Text style={{ color: colors.danger, fontSize: 12 }}>Insufficient SOL balance for fee.</Text>
                         </View>
                      )}

                      <Button
                         title={payingFee ? 'Processing Payment...' : `Pay Fee (${paymentToken})`}
                         onPress={onPayFee}
                         variant="primary"
                         disabled={payingFee || simulating || !!hasInsufficientSeeker || !!hasInsufficientSol}
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
        recipientsCount={effectiveValidRecipients}
        totalAmountUi={calculatedTotalUi}
        asset={selectedAsset}
        batchesCount={builtBatches.length}
        feeQuote={feeQuote}
      />
    </Screen>
  );
}
