import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { AppState as NativeAppState, AppStateStatus } from 'react-native';

import { appReducer, initialAppState } from './reducer';
import type { AppAction, AppState } from './types';
import { StorageService, KEYS } from '../services/StorageService';
import { setNetwork } from '../services/SolanaService';
import { lockBuiltIn } from '../services/WalletService';
import { Logger } from '../utils/Logger';
import { TOKENS } from '../config/tokens';

type AppContextValue = {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  const appState = useRef(NativeAppState.currentState);

  // Auto-lock on background
  useEffect(() => {
    const subscription = NativeAppState.addEventListener('change', nextAppState => {
      if (
        appState.current === 'active' &&
        (nextAppState === 'inactive' || nextAppState === 'background')
      ) {
        // Leaving the app (task switcher, home, another app) — lock like Phantom-style wallets
        if (state.walletMode === 'built_in' && state.builtInWalletStatus === 'unlocked') {
          lockBuiltIn();
          void StorageService.setItem(KEYS.WALLET_LOCKED, 'true');
          dispatch({ type: 'wallet/lockedBuiltIn' });
          Logger.info('App left foreground: Wallet locked for security.');
        }
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [state.walletMode, state.builtInWalletStatus]);

  // Load persisted settings
  useEffect(() => {
    async function loadSettings() {
      try {
        const treasury = await StorageService.getItem(KEYS.TREASURY_ADDRESS);
        if (treasury) {
          dispatch({ type: 'settings/setTreasuryAddress', treasuryAddress: treasury });
        } else {
          // First run: save default
          await StorageService.setItem(KEYS.TREASURY_ADDRESS, initialAppState.treasuryAddress);
        }

        const feeTokenMint = await StorageService.getItem(KEYS.FEE_TOKEN_MINT);
        if (feeTokenMint === TOKENS.SOL.mint || feeTokenMint === TOKENS.SKR.mint) {
          dispatch({ type: 'settings/setFeeTokenMint', feeTokenMint });
        }

        const discount = await StorageService.getItem(KEYS.SEEKER_DISCOUNT);
        if (discount === 'true' && !initialAppState.seekerDiscountEnabled) {
          dispatch({ type: 'settings/toggleSeekerDiscount' });
        }

        const network = await StorageService.getItem(KEYS.NETWORK_MODE);
        if (network === 'devnet' || network === 'mainnet-beta') {
          dispatch({ type: 'settings/setNetwork', network });
          setNetwork(network); // Sync service
        } else {
          // Default
          setNetwork(initialAppState.network);
          await StorageService.setItem(KEYS.NETWORK_MODE, initialAppState.network);
        }
      } catch (e) {
        Logger.error('Settings load failed', e);
      }
    }
    loadSettings();
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within AppProvider');
  }
  return ctx;
}
