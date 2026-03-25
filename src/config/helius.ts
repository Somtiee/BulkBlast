/**
 * Helius stays server-side only (via proxy).
 * The client never receives API keys; it only calls EXPO_PUBLIC_PROXY_BASE_URL.
 */
import { PROXY_CONFIG, hasProxyBaseUrl } from './proxy';

export const getHeliusRpcUrl = (network: 'mainnet-beta' | 'devnet'): string | null => {
  if (!hasProxyBaseUrl()) return null;
  return network === 'devnet'
    ? `${PROXY_CONFIG.BASE_URL}/helius-rpc/devnet`
    : `${PROXY_CONFIG.BASE_URL}/helius-rpc/mainnet`;
};

// Backward-compatible export used by diagnostics UI.
export const hasHeliusKey = (): boolean => hasProxyBaseUrl();
