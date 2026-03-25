// Jupiter API Configuration

import { PROXY_CONFIG, hasProxyBaseUrl } from './proxy';

export const JUPITER_CONFIG = {
  /**
   * Client uses the proxy. The worker injects the real x-api-key server-side.
   * Route mapping: /jupiter/price/v3 -> https://api.jup.ag/price/v3
   */
  PRICE_PROXY_BASE_URL: hasProxyBaseUrl() ? `${PROXY_CONFIG.BASE_URL}/jupiter` : '',
};

export const hasJupiterProxy = (): boolean => JUPITER_CONFIG.PRICE_PROXY_BASE_URL.length > 0;

// Backward-compatible export: Swap UI uses this to decide whether Jupiter is available.
// In the new architecture, Jupiter availability depends on the proxy base URL.
export const hasJupiterApiKey = (): boolean => hasJupiterProxy();
