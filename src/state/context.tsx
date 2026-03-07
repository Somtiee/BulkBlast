import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { AppState as NativeAppState, AppStateStatus } from 'react-native';

import { appReducer, initialAppState } from './reducer';
import type { AppAction, AppState } from './types';
import { StorageService, KEYS } from '../services/StorageService';
import { setNetwork } from '../services/SolanaService';
import { lockBuiltIn } from '../services/WalletService';
import { Logger } from '../utils/Logger';

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
        appState.current.match(/active/) &&
        nextAppState.match(/inactive|background/)
      ) {
        // App going to background -> Lock wallet
        if (state.walletMode === 'built_in' && state.builtInWalletStatus === 'unlocked') {
           lockBuiltIn();
           dispatch({ type: 'wallet/lockedBuiltIn' });
           Logger.info('App backgrounded: Wallet locked for security.');
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
      const treasury = await StorageService.getItem(KEYS.TREASURY_ADDRESS);
      if (treasury) {
        dispatch({ type: 'settings/setTreasuryAddress', treasuryAddress: treasury });
      } else {
        // First run: save default
        StorageService.setItem(KEYS.TREASURY_ADDRESS, initialAppState.treasuryAddress);
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
        StorageService.setItem(KEYS.NETWORK_MODE, initialAppState.network);
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
