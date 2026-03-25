import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Switch, Alert, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';

import type { MainTabsParamList } from '../../navigation/types';
import { Button, Card, Divider, Screen } from '../../components/ui';
import { StickyAppHeader } from '../../components/ui/StickyAppHeader';
import { spacing, typography, useTheme } from '../../theme';
import { useApp } from '../../state/context';
import { 
  hasBuiltInWallet, 
  lockBuiltIn, 
  unlockBuiltIn, 
  wipeBuiltInWallet,
  exportPrivateKeyBase58
} from '../../services/WalletService';
import { getNetwork, setNetwork } from '../../services/SolanaService';
import { StorageService, KEYS } from '../../services/StorageService';
import { hasJupiterApiKey } from '../../config/jupiter';
import { hasHeliusKey } from '../../config/helius';
import { hasDflowApiKey, hasDflowProxy } from '../../config/dflow';
import { TOKENS } from '../../config/tokens';

type Props = NativeStackScreenProps<MainTabsParamList, 'Settings'>;

export function Settings({ navigation }: Props) {
  const { state, dispatch } = useApp();
  const { colors, setMode, isDark } = useTheme();
  const [hasStored, setHasStored] = useState(false);
  const [loading, setLoading] = useState(false);
  const [networkMode, setNetworkMode] = useState(getNetwork());

  useEffect(() => {
    checkWallet();
  }, [state.walletMode]);

  async function checkWallet() {
    const exists = await hasBuiltInWallet();
    setHasStored(exists);
  }

  // ... (handlers remain mostly same, just slight cleanup)
  async function handleLock() {
    try {
      setLoading(true);
      await lockBuiltIn();
      await StorageService.setItem(KEYS.WALLET_LOCKED, 'true');
      dispatch({ type: 'wallet/lockedBuiltIn' });
    } catch (e) {
      Alert.alert('Error', 'Failed to lock wallet');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock() {
    try {
      setLoading(true);
      const res = await unlockBuiltIn();
      await StorageService.setItem(KEYS.WALLET_LOCKED, 'false');
      dispatch({ type: 'wallet/unlockedBuiltIn', publicKey: res.publicKey });
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to unlock wallet');
    } finally {
      setLoading(false);
    }
  }

  async function handleWipe() {
    Alert.alert(
      'Wipe Wallet',
      'Are you sure you want to permanently delete your wallet from this device? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await wipeBuiltInWallet();
              await StorageService.deleteItem(KEYS.WALLET_LOCKED);
              dispatch({ type: 'wallet/reset' });
              setHasStored(false);
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to wipe wallet');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  }

  async function toggleSeekerDiscount() {
    if (!state.solanaMobileOwner) {
      Alert.alert('Not Eligible', 'SEEKER discount is available only on Solana Mobile (Saga).');
      return;
    }
    dispatch({ type: 'settings/toggleSeekerDiscount' });
  }

  async function setDefaultFeeToken(token: 'SOL' | 'SKR') {
    const mint = token === 'SOL' ? TOKENS.SOL.mint : TOKENS.SKR.mint;
    dispatch({ type: 'settings/setFeeTokenMint', feeTokenMint: mint });
    await StorageService.setItem(KEYS.FEE_TOKEN_MINT, mint);
  }

  async function handleExportKey() {
    try {
      const isLocked = state.builtInWalletStatus === 'locked';
      if (isLocked) {
        Alert.alert('Wallet Locked', 'Please unlock your wallet first.');
        return;
      }
      
      const key = await exportPrivateKeyBase58();
      Alert.alert(
        'Private Key (Base58)', 
        key,
        [
          { text: 'Copy', onPress: async () => { await Clipboard.setStringAsync(key); } },
          { text: 'Close', style: 'cancel' },
        ]
      );
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  // --- Diagnostics Component (Only visible in Dev or by tap combo?) ---
  // For now, let's just make it a visible section at the bottom since it's harmless metadata
  // In a real release, you might wrap this in __DEV__ check.
  const Diagnostics = () => (
    <View style={styles.diagnosticsContainer}>
      <Text style={[styles.diagnosticsHeader, { color: colors.textSecondary }]}>Diagnostics</Text>
      
      <View style={styles.diagRow}>
        <Text style={[styles.diagLabel, { color: colors.text }]}>Network:</Text>
        <Text style={[styles.diagValue, { color: colors.primary }]}>{networkMode}</Text>
      </View>
      
      <View style={styles.diagRow}>
        <Text style={[styles.diagLabel, { color: colors.text }]}>Wallet Mode:</Text>
        <Text style={[styles.diagValue, { color: colors.text }]}>{state.walletMode || 'None'}</Text>
      </View>

      <View style={styles.diagRow}>
        <Text style={[styles.diagLabel, { color: colors.text }]}>Jupiter Key:</Text>
        <Text style={[styles.diagValue, { color: hasJupiterApiKey() ? colors.success : colors.error }]}>
          {hasJupiterApiKey() ? 'Present' : 'Missing'}
        </Text>
      </View>

      <View style={styles.diagRow}>
        <Text style={[styles.diagLabel, { color: colors.text }]}>Helius Key:</Text>
        <Text style={[styles.diagValue, { color: hasHeliusKey() ? colors.success : colors.error }]}>
          {hasHeliusKey() ? 'Present' : 'Missing'}
        </Text>
      </View>

      <View style={styles.diagRow}>
        <Text style={[styles.diagLabel, { color: colors.text }]}>Dflow Key:</Text>
        <Text style={[styles.diagValue, { color: (hasDflowApiKey() || hasDflowProxy()) ? colors.success : colors.danger }]}>
          {hasDflowProxy() ? 'Present (Proxy)' : hasDflowApiKey() ? 'Present' : 'Missing'}
        </Text>
      </View>
      
      <Text style={[styles.diagFooter, { color: colors.textSecondary }]}>
        Version: {Constants.expoConfig?.version || '1.0.0'}
      </Text>
    </View>
  );

  return (
    <Screen contentStyle={styles.scrollContent}>
      <StickyAppHeader title="Settings" />
      
      {/* Appearance & Extras */}
      <Card style={styles.section}>
         <Text style={[styles.sectionTitle, { color: colors.text }]}>Preferences</Text>
         <Divider style={styles.divider} />

         <View style={styles.settingRow}>
            <Text style={{ color: colors.text, flex: 1 }}>Dark Mode</Text>
            <Switch 
              value={isDark} 
              onValueChange={() => setMode(isDark ? 'light' : 'dark')}
            />
         </View>
         
         <View style={[styles.settingRow, { marginTop: spacing[4] }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text }}>Seeker Discount</Text>
              <Text style={{ color: colors.textSecondary, fontSize: 10 }}>Requires Saga/Solana Mobile</Text>
            </View>
            <Switch 
              value={state.seekerDiscountEnabled} 
              onValueChange={toggleSeekerDiscount}
              disabled={!state.solanaMobileOwner}
            />
         </View>

         <View style={{ marginTop: spacing[4] }}>
            <Text style={{ color: colors.text, marginBottom: spacing[2] }}>Default Fee Token</Text>
            <View style={{ flexDirection: 'row', gap: spacing[2] }}>
              <TouchableOpacity
                onPress={() => setDefaultFeeToken('SKR')}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: state.feeTokenMint === TOKENS.SKR.mint ? colors.primary : colors.border,
                  backgroundColor: state.feeTokenMint === TOKENS.SKR.mint ? colors.primary + '14' : colors.surface2,
                  padding: spacing[3],
                }}
              >
                <Text style={{ color: state.feeTokenMint === TOKENS.SKR.mint ? colors.primary : colors.text, fontWeight: '700', textAlign: 'center' }}>
                  SKR
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDefaultFeeToken('SOL')}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: state.feeTokenMint === TOKENS.SOL.mint ? colors.primary : colors.border,
                  backgroundColor: state.feeTokenMint === TOKENS.SOL.mint ? colors.primary + '14' : colors.surface2,
                  padding: spacing[3],
                }}
              >
                <Text style={{ color: state.feeTokenMint === TOKENS.SOL.mint ? colors.primary : colors.text, fontWeight: '700', textAlign: 'center' }}>
                  SOL
                </Text>
              </TouchableOpacity>
            </View>
         </View>
      </Card>

      {/* Network Section */}
      <Card style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Network</Text>
        <Divider style={styles.divider} />
        
        <View style={styles.settingRow}>
          <Text style={{ color: colors.text, flex: 1 }}>Use Mainnet (Real Money)</Text>
          <Switch 
            value={networkMode === 'mainnet-beta'} 
            onValueChange={(val) => {
               const next = val ? 'mainnet-beta' : 'devnet';
               setNetworkMode(next);
               setNetwork(next);
               StorageService.setItem(KEYS.NETWORK_MODE, next);
               dispatch({ type: 'settings/setNetwork', network: next });
               Alert.alert('Network Changed', `Switched to ${next}. Please reload/refresh assets.`);
            }}
          />
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
           Current: {networkMode}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: spacing[3], lineHeight: 18 }}>
          Bags Launch & Blast only works on{' '}
          <Text style={{ fontWeight: '700', color: colors.text }}>mainnet</Text>
          {' '}(Bags + partner PDA). On devnet you can still practice{' '}
          <Text style={{ fontWeight: '700', color: colors.text }}>Bulk Blast</Text>
          {' '}airdrops with free devnet SOL — no real-money launch.
        </Text>
      </Card>

      {/* Wallet Management Section */}
      <Card style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Wallet</Text>
        <Divider style={styles.divider} />
        
        {!state.walletPublicKey ? (
           <Text style={{ color: colors.textSecondary, marginBottom: spacing[4] }}>No wallet connected.</Text>
        ) : (
           <View style={{ marginBottom: spacing[4] }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Public Key:</Text>
              <TouchableOpacity onPress={() => {
                  Clipboard.setStringAsync(state.walletPublicKey || '');
                  Alert.alert('Copied', 'Address copied to clipboard');
              }}>
                <Text style={{ color: colors.primary, fontSize: 13 }} numberOfLines={1} ellipsizeMode="middle">
                  {state.walletPublicKey}
                </Text>
              </TouchableOpacity>
           </View>
        )}

        <View style={styles.row}>
          {hasStored ? (
             state.builtInWalletStatus === 'locked' ? (
               <Button title="Unlock Wallet" onPress={handleUnlock} loading={loading} style={styles.actionBtn} />
             ) : (
               <>
                 <Button title="Lock Wallet" onPress={handleLock} loading={loading} variant="secondary" style={styles.actionBtn} />
                 <Button title="Export Key" onPress={handleExportKey} variant="secondary" style={styles.actionBtn} />
               </>
             )
          ) : (
             <Text style={{ color: colors.textSecondary }}>No built-in wallet found.</Text>
          )}
          
          {hasStored && (
             <Button 
               title="Wipe" 
               onPress={handleWipe} 
               variant="danger" // Changed from 'destructive' (which doesn't exist in ButtonVariant) to 'danger'
               style={[styles.actionBtn, { backgroundColor: colors.danger, borderColor: colors.danger }]} 
               textStyle={{ color: 'white' }}
             />
          )}
        </View>
      </Card>

      {/* Diagnostics Section */}
      <Diagnostics />

    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing[4],
    paddingBottom: 40,
  },
  section: {
    marginBottom: spacing[6],
    padding: spacing[4],
  },
  sectionTitle: {
    fontSize: typography.fontSize.title,
    fontWeight: typography.weight.bold,
    marginBottom: spacing[2],
  },
  divider: {
    marginBottom: spacing[4],
  },
  row: {
    flexDirection: 'row',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  actionBtn: {
    flex: 1,
    minWidth: 100,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  diagnosticsContainer: {
    marginTop: spacing.xl,
    padding: spacing[4],
    opacity: 0.8,
  },
  diagnosticsHeader: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: spacing[2],
    textTransform: 'uppercase',
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  diagLabel: {
    fontSize: 12,
  },
  diagValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  diagFooter: {
    marginTop: spacing[4],
    fontSize: 10,
    textAlign: 'center',
  },
});
