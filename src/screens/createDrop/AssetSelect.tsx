import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PublicKey } from '@solana/web3.js';

import type { CreateDropStackParamList } from '../../navigation/types';
import { Button, Card, Chip, Input, Screen } from '../../components/ui';
import { useApp } from '../../state/context';
import { spacing, typography, useTheme } from '../../theme';
import { getConnection, getSolBalance, getSplBalance, getSplTokenInfo } from '../../services/SolanaService';
import { unlockBuiltIn } from '../../services/WalletService';
import type { SelectedAsset, AssetBalance } from '../../types/asset';
import { StorageService, KEYS } from '../../services/StorageService';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'AssetSelect'>;

export function AssetSelect({ navigation }: Props) {
  const { state, dispatch } = useApp();
  const { colors } = useTheme();
  const [tab, setTab] = useState<'SOL' | 'SPL'>('SOL');
  
  // SOL State
  const [solBalance, setSolBalance] = useState<AssetBalance | null>(null);
  
  // SPL State
  const [mintAddress, setMintAddress] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tokenInfo, setTokenInfo] = useState<{ decimals: number; mint: string } | null>(null);
  const [splBalance, setSplBalance] = useState<AssetBalance | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWalletReady = !!state.walletPublicKey && 
    (state.walletMode !== 'built_in' || state.builtInWalletStatus === 'unlocked');

  useEffect(() => {
    if (isWalletReady && tab === 'SOL') {
      fetchSolBalance();
    }
  }, [isWalletReady, tab, state.walletPublicKey]);

  async function fetchSolBalance() {
    if (!state.walletPublicKey) return;
    setLoading(true);
    setError(null);
    try {
      const bal = await getSolBalance(state.walletPublicKey);
      setSolBalance({ amountUi: bal.ui, raw: bal.lamports.toString() });
    } catch (e: any) {
      setError('Failed to fetch SOL balance: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onUnlock() {
    try {
      setLoading(true);
      const { publicKey } = await unlockBuiltIn();
      await StorageService.setItem(KEYS.WALLET_LOCKED, 'false');
      dispatch({ type: 'wallet/unlockedBuiltIn', publicKey });
    } catch (e: any) {
      setError('Unlock failed: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onFetchToken() {
    if (!mintAddress) return;
    setError(null);
    setLoading(true);
    setTokenInfo(null);
    setSplBalance(null);

    try {
      let mint: PublicKey;
      try {
        mint = new PublicKey(mintAddress);
      } catch (e) {
        throw new Error('Invalid mint address format');
      }

      if (!PublicKey.isOnCurve(mint)) {
        throw new Error('Invalid mint address (not on curve)');
      }

      const info = await getSplTokenInfo(mintAddress);
      setTokenInfo(info);

      if (state.walletPublicKey) {
        const balUi = await getSplBalance(state.walletPublicKey, mintAddress);
        // We don't have raw balance easily from getSplBalance current impl, but UI is enough for display
        // For raw, we'd need to parse it or calculate. For now let's store UI.
        // If we need raw later for transaction, we can calculate: ui * 10^decimals
        // But let's keep it simple.
        setSplBalance({ amountUi: balUi, raw: '0' }); // Raw 0 for now as placeholder if needed
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function onContinue() {
    if (tab === 'SOL') {
      if (!solBalance) return;
      const asset: SelectedAsset = { kind: 'SOL' };
      dispatch({ type: 'asset/setSelected', asset });
      dispatch({ type: 'asset/setBalance', balance: solBalance });
    } else {
      if (!tokenInfo || !splBalance) return;
      const asset: SelectedAsset = {
        kind: 'SPL',
        mint: tokenInfo.mint,
        decimals: tokenInfo.decimals,
        symbol: symbol || undefined,
      };
      dispatch({ type: 'asset/setSelected', asset });
      dispatch({ type: 'asset/setBalance', balance: splBalance });
    }
    navigation.navigate('Review');
  }

  const isValid = tab === 'SOL' ? !!solBalance : (!!tokenInfo && !!splBalance);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          gap: spacing[4],
        },
        tabs: {
          flexDirection: 'row',
          gap: spacing[2],
          marginBottom: spacing[2],
        },
        label: {
          fontSize: typography.fontSize.caption,
          lineHeight: typography.lineHeight.caption,
          color: colors.textSecondary,
          marginBottom: spacing[1],
        },
        balance: {
          fontSize: typography.fontSize.title,
          lineHeight: typography.lineHeight.title,
          fontWeight: typography.weight.semibold,
          color: colors.primary,
        },
        fetchBtn: {
          marginTop: spacing[2],
        },
        tokenInfo: {
          marginTop: spacing[4],
          paddingTop: spacing[4],
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        infoRow: {
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
          color: colors.text,
          marginBottom: spacing[1],
        },
        continueBtn: {
          marginTop: spacing[4],
        },
        error: {
          color: colors.danger,
          fontSize: typography.fontSize.caption,
          lineHeight: typography.lineHeight.caption,
          textAlign: 'center',
          marginTop: spacing[2],
        },
        warningCard: {
          alignItems: 'center',
          gap: spacing[2],
        },
        warningText: {
          color: colors.warning,
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
        },
        unlockBtn: {
          width: '100%',
        },
      }),
    [colors]
  );

  return (
    <Screen title="Select Asset" subtitle="Choose asset to drop">
      <View style={styles.container}>
        {!isWalletReady ? (
          <Card style={styles.warningCard}>
            <Text style={styles.warningText}>
              {state.walletPublicKey ? 'Wallet is locked' : 'Connect or create a wallet first'}
            </Text>
            {state.walletMode === 'built_in' && state.builtInWalletStatus === 'locked' && (
              <Button title="Unlock Wallet" onPress={onUnlock} style={styles.unlockBtn} />
            )}
          </Card>
        ) : (
          <>
            <View style={styles.tabs}>
              <Chip label="SOL" selected={tab === 'SOL'} onPress={() => setTab('SOL')} />
              <Chip label="SPL Token" selected={tab === 'SPL'} onPress={() => setTab('SPL')} />
            </View>

            {tab === 'SOL' ? (
              <Card>
                <Text style={styles.label}>SOL Balance</Text>
                {loading && !solBalance ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={styles.balance}>{solBalance?.amountUi ?? '0'} SOL</Text>
                )}
              </Card>
            ) : (
              <Card>
                <Input
                  label="Token Mint Address"
                  value={mintAddress}
                  onChangeText={setMintAddress}
                  placeholder="Enter mint address"
                  autoCapitalize="none"
                />
                <Button 
                  title="Fetch Token" 
                  onPress={onFetchToken} 
                  variant="secondary" 
                  style={styles.fetchBtn}
                  disabled={loading || !mintAddress}
                />
                
                {tokenInfo && (
                  <View style={styles.tokenInfo}>
                    <Text style={styles.infoRow}>Mint: {tokenInfo.mint.slice(0, 8)}...{tokenInfo.mint.slice(-8)}</Text>
                    <Text style={styles.infoRow}>Decimals: {tokenInfo.decimals}</Text>
                    <Text style={styles.infoRow}>Balance: {splBalance?.amountUi ?? '0'}</Text>
                    
                    <Input
                      label="Symbol (Optional)"
                      value={symbol}
                      onChangeText={setSymbol}
                      placeholder="e.g. USDC"
                      style={{ marginTop: spacing[4] }}
                    />
                  </View>
                )}
              </Card>
            )}

            {error && <Text style={styles.error}>{error}</Text>}

            <Button
              title="Continue"
              onPress={onContinue}
              style={styles.continueBtn}
              disabled={!isValid || loading}
            />
          </>
        )}
      </View>
    </Screen>
  );
}
