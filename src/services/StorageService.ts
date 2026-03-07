import * as ExpoSecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { DropReceipt } from '../types/receipt';

const isWeb = Platform.OS === 'web';

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
};

export const KEYS = {
  TREASURY_ADDRESS: 'bulkblast.settings.treasury',
  SEEKER_DISCOUNT: 'bulkblast.settings.seeker_discount',
  THEME_MODE: 'bulkblast.settings.theme_mode',
  NETWORK_MODE: 'bulkblast.settings.network_mode',
  WALLET_LOCKED: 'bulkblast.wallet.locked',
  RECEIPTS: 'bulkblast.history.receipts',
};
