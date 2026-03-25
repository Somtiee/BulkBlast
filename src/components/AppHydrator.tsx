import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useApp } from '../state/context';
import {
  hasBuiltInWallet,
  getBuiltInPublicKey,
  unlockBuiltInSilently,
  registerBuiltInUnlockListener,
} from '../services/WalletService';
import { StorageService, KEYS } from '../services/StorageService';
import { useTheme } from '../theme';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { setNetwork } from '../services/SolanaService';
import { DEFAULT_NETWORK } from '../config';
import { TOKENS } from '../config/tokens';

export function AppHydrator({ children, onReady }: { children: React.ReactNode; onReady: () => void }) {
  const { dispatch } = useApp();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function hydrate() {
      try {
        // 1. Restore Network
        const network = await StorageService.getItem(KEYS.NETWORK_MODE);
        if (network === 'devnet') {
           setNetwork('devnet');
        } else if (network === 'mainnet-beta') {
           setNetwork('mainnet-beta');
        } else {
           setNetwork(DEFAULT_NETWORK);
        }

        // 2. Restore Settings
        const treasury = await StorageService.getItem(KEYS.TREASURY_ADDRESS);
        if (treasury) {
          dispatch({ type: 'settings/setTreasuryAddress', treasuryAddress: treasury });
        }

        const feeTokenMint = await StorageService.getItem(KEYS.FEE_TOKEN_MINT);
        if (feeTokenMint === TOKENS.SOL.mint || feeTokenMint === TOKENS.SKR.mint) {
          dispatch({ type: 'settings/setFeeTokenMint', feeTokenMint });
        }
        
        const discount = await StorageService.getItem(KEYS.SEEKER_DISCOUNT);
        if (discount === 'true') {
          dispatch({ type: 'settings/toggleSeekerDiscount' });
        } else if (discount === 'false') {
          // Default is false, but ensure consistency if needed
        }
        
        // 3. Detect Solana Mobile owner (heuristic)
        const name = (Constants?.deviceName || '').toLowerCase();
        const model = (Constants?.platform?.ios?.model || Constants?.platform?.android?.model || '').toLowerCase();
        const isSaga = name.includes('saga') || name.includes('solana') || model.includes('saga') || model.includes('solana');
        const isEligible = Platform.OS === 'android' && isSaga;
        dispatch({ type: 'settings/setSolanaMobileOwner', value: isEligible });

        // 4. Restore Wallet
        const hasWallet = await hasBuiltInWallet();
        if (hasWallet) {
          const walletLocked = await StorageService.getItem(KEYS.WALLET_LOCKED);
          const shouldLock = walletLocked === 'true';
          const publicKey = await getBuiltInPublicKey();
          if (publicKey) {
            if (shouldLock) {
              dispatch({ type: 'wallet/createdBuiltIn', publicKey });
              dispatch({ type: 'wallet/lockedBuiltIn' });
            } else {
              try {
                const res = await unlockBuiltInSilently();
                dispatch({ type: 'wallet/unlockedBuiltIn', publicKey: res.publicKey });
              } catch {
                dispatch({ type: 'wallet/createdBuiltIn', publicKey });
                dispatch({ type: 'wallet/lockedBuiltIn' });
              }
            }
          }
        }
      } catch (e) {
        console.error('Hydration failed', e);
      } finally {
        setLoading(false);
        onReady();
      }
    }

    hydrate();
  }, [dispatch, onReady]);

  // Keep Redux in sync when the user unlocks via biometric/device PIN during signing (signTransaction → unlockBuiltIn).
  useEffect(() => {
    return registerBuiltInUnlockListener((publicKey) => {
      dispatch({ type: 'wallet/unlockedBuiltIn', publicKey });
    });
  }, [dispatch]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
