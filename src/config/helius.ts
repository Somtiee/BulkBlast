// Helius API Configuration
// Provides high-performance RPC and DAS (Digital Asset Standard) API access.

export const HELIUS_CONFIG = {
  // API Key (from helius.dev)
  // In a real app, this should be injected via environment variables.
  // DO NOT COMMIT REAL KEYS TO SOURCE CONTROL.
  API_KEY: (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_HELIUS_API_KEY) || '',
};

export const hasHeliusKey = (): boolean => {
  return !!HELIUS_CONFIG.API_KEY && HELIUS_CONFIG.API_KEY.length > 0;
};

export const getHeliusRpcUrl = (network: 'mainnet-beta' | 'devnet'): string | null => {
  if (!hasHeliusKey()) return null;
  
  if (network === 'mainnet-beta') {
    return `https://mainnet.helius-rpc.com/?api-key=${HELIUS_CONFIG.API_KEY}`;
  }
  
  if (network === 'devnet') {
    return `https://devnet.helius-rpc.com/?api-key=${HELIUS_CONFIG.API_KEY}`;
  }
  
  return null;
};
