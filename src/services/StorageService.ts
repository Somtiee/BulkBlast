import * as ExpoSecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { DropReceipt } from '../types/receipt';

const isWeb = Platform.OS === 'web';
const MAX_BAGS_LAUNCH_HISTORY = 200;

export type BagsLaunchHistoryItem = {
  id: string;
  createdAt: number;
  walletPublicKey: string;
  tokenMint: string;
  tokenSymbol: string;
  signature: string;
};

export const StorageService = {
  getItem: async (key: string): Promise<string | null> => {
    if (isWeb) {
      return localStorage.getItem(key);
    }
    return ExpoSecureStore.getItemAsync(key);
  },

  setItem: async (key: string, value: string): Promise<void> => {
    if (isWeb) {
      localStorage.setItem(key, value);
      return;
    }
    return ExpoSecureStore.setItemAsync(key, value);
  },

  deleteItem: async (key: string): Promise<void> => {
    if (isWeb) {
      localStorage.removeItem(key);
      return;
    }
    return ExpoSecureStore.deleteItemAsync(key);
  },

  listReceipts: async (): Promise<DropReceipt[]> => {
    const raw = await StorageService.getItem(KEYS.RECEIPTS);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr as DropReceipt[];
      return [];
    } catch {
      return [];
    }
  },

  saveReceipt: async (receipt: DropReceipt): Promise<void> => {
    const current = await StorageService.listReceipts();
    current.push(receipt);
    await StorageService.setItem(KEYS.RECEIPTS, JSON.stringify(current));
  },

  updateReceipt: async (receipt: DropReceipt): Promise<void> => {
    const current = await StorageService.listReceipts();
    const idx = current.findIndex((r) => r.id === receipt.id);
    if (idx >= 0) current[idx] = receipt;
    else current.push(receipt);
    await StorageService.setItem(KEYS.RECEIPTS, JSON.stringify(current));
  },

  clearReceipts: async (): Promise<void> => {
    await StorageService.deleteItem(KEYS.RECEIPTS);
  },

  listBagsLaunches: async (): Promise<BagsLaunchHistoryItem[]> => {
    const raw = await StorageService.getItem(KEYS.BAGS_LAUNCH_HISTORY);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr
        .map((item) => {
          const launch = item as Partial<BagsLaunchHistoryItem>;
          return {
            id: String(launch.id ?? ''),
            createdAt: Number(launch.createdAt ?? 0),
            walletPublicKey: String(launch.walletPublicKey ?? ''),
            tokenMint: String(launch.tokenMint ?? ''),
            tokenSymbol: String(launch.tokenSymbol ?? ''),
            signature: String(launch.signature ?? ''),
          } as BagsLaunchHistoryItem;
        })
        .filter((item) => item.signature.length > 0 && item.tokenMint.length > 0);
    } catch {
      return [];
    }
  },

  saveBagsLaunch: async (launch: BagsLaunchHistoryItem): Promise<void> => {
    const current = await StorageService.listBagsLaunches();
    const next = [launch, ...current.filter((item) => item.signature !== launch.signature)];
    await StorageService.setItem(
      KEYS.BAGS_LAUNCH_HISTORY,
      JSON.stringify(next.slice(0, MAX_BAGS_LAUNCH_HISTORY))
    );
  },

  clearBagsLaunches: async (): Promise<void> => {
    await StorageService.deleteItem(KEYS.BAGS_LAUNCH_HISTORY);
  },
};

export const KEYS = {
  TREASURY_ADDRESS: 'bulkblast.settings.treasury',
  FEE_TOKEN_MINT: 'bulkblast.settings.fee_token_mint',
  SEEKER_DISCOUNT: 'bulkblast.settings.seeker_discount',
  THEME_MODE: 'bulkblast.settings.theme_mode',
  NETWORK_MODE: 'bulkblast.settings.network_mode',
  WALLET_LOCKED: 'bulkblast.wallet.locked',
  RECEIPTS: 'bulkblast.history.receipts',
  BAGS_LAUNCH_HISTORY: 'bulkblast.history.bags_launches',
};
