import React, { useEffect, useState, useMemo } from 'react';
import { StyleSheet, View, Text, Switch, Alert, ScrollView, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';

import type { MainTabsParamList } from '../../navigation/types';
import { Button, Card, Divider } from '../../components/ui';
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
    await StorageService.setItem(KEYS.SEEKER_DISCOUNT, (!state.seekerDiscountEnabled).toString());
  }
  
  async function handleNetworkSwitch(val: boolean) {
    const newNet = val ? 'devnet' : 'mainnet-beta';
    setNetwork(newNet);
    setNetworkMode(newNet);
    await StorageService.setItem(KEYS.NETWORK_MODE, newNet);
    Alert.alert('Network Changed', `Switched to ${newNet}`);
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

  const isBuiltIn = state.walletMode === 'built_in';
  const isLocked = state.builtInWalletStatus === 'locked';

  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      paddingBottom: spacing[8],
    },
    section: {
      marginTop: spacing[6],
      paddingHorizontal: spacing[4],
    },
    sectionHeader: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: spacing[2],
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    group: {
      backgroundColor: colors.surface2,
      borderRadius: 12,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing[4],
      backgroundColor: colors.surface2,
    },
    rowBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    label: {
      fontSize: 16,
      color: colors.text,
      fontWeight: '500',
    },
    value: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    hint: {
        fontSize: 12,
        color: colors.textSecondary,
        paddingHorizontal: spacing[4],
        marginTop: spacing[2],
    },
    destructiveText: {
        color: colors.danger,
    }
  }), [colors]);

  const SettingRow = ({ label, value, onPress, isLast, children }: any) => (
    <TouchableOpacity 
      style={[styles.row, !isLast && styles.rowBorder]} 
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={[styles.label, onPress && { color: colors.primary }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {value && <Text style={styles.value}>{value}</Text>}
        {children}
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StickyAppHeader title="Settings" showLogo={false} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Appearance */}
        <View style={styles.section}>
            <Text style={styles.sectionHeader}>Appearance</Text>
            <View style={styles.group}>
                <View style={styles.row}>
                    <Text style={styles.label}>Dark Mode</Text>
                    <Switch 
                        value={isDark} 
                        onValueChange={(val) => setMode(val ? 'dark' : 'light')} 
                        trackColor={{ false: colors.border, true: colors.primary }}
                    />
                </View>
            </View>
        </View>

        {/* Network */}
        <View style={styles.section}>
            <Text style={styles.sectionHeader}>Network</Text>
            <View style={styles.group}>
                <View style={styles.row}>
                    <Text style={styles.label}>Developer Mode (Devnet)</Text>
                    <Switch 
                        value={networkMode === 'devnet'} 
                        onValueChange={handleNetworkSwitch} 
                        trackColor={{ false: colors.border, true: colors.primary }}
                    />
                </View>
            </View>
            <Text style={styles.hint}>Current Endpoint: {networkMode}</Text>
        </View>

        {/* Integrations */}
        <View style={styles.section}>
            <Text style={styles.sectionHeader}>Integrations</Text>
            <View style={styles.group}>
                <SettingRow label="Jupiter Aggregator" value={hasJupiterApiKey() ? 'Active' : 'Missing Key'} />
                <SettingRow label="Helius RPC" value={hasHeliusKey() ? 'Active' : 'Missing Key'} isLast />
            </View>
        </View>

        {/* Wallet Management */}
        <View style={styles.section}>
            <Text style={styles.sectionHeader}>Wallet Management</Text>
            <View style={styles.group}>
                <SettingRow label="Type" value={isBuiltIn ? 'Built-in' : 'External'} />
                {state.walletPublicKey && (
                    <SettingRow label="Address" value={state.walletPublicKey.slice(0, 4) + '...' + state.walletPublicKey.slice(-4)} onPress={() => Clipboard.setStringAsync(state.walletPublicKey!)} />
                )}
                
                {(isBuiltIn || hasStored) && (
                    <>
                        <SettingRow 
                           label={isLocked ? "Unlock Wallet" : "Lock Wallet"} 
                           onPress={isLocked ? handleUnlock : handleLock}
                        />
                        
                        {!isLocked && (
                             <SettingRow 
                                label="Export Private Key" 
                                onPress={handleExportKey}
                             />
                        )}

                        <SettingRow 
                           label="Wipe Wallet Data" 
                           onPress={handleWipe}
                           isLast
                        >
                            <Text style={{ color: colors.danger }}>⚠️</Text>
                        </SettingRow>
                    </>
                )}
            </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}
