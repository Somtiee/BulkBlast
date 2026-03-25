/**
 * Bags.fm API — Launch & Blast (token launch + bulk distribution).
 *
 * SECURITY (read before shipping):
 * - Never commit real API keys, partner secrets, or `.env` to git.
 * - Expo bundles `EXPO_PUBLIC_*` into the client; treat them as public. For production
 *   partner keys, prefer a small backend proxy that holds the secret server-side.
 *
 * Values come from `app.config.js` → `expo.extra` (loaded via dotenv from `.env`),
 * with fallback to `process.env` for web/tests.
 */

import { PROXY_CONFIG, hasProxyBaseUrl } from '../config/proxy';

/** Bags public API v2 base (no trailing slash). */
export const BAGS_BASE_URL = 'https://public-api-v2.bags.fm/api/v1';

/**
 * Client-side base URL for Bags endpoints via your server-side proxy.
 * Route mapping (worker): /bags/* -> https://public-api-v2.bags.fm/api/v1/*
 */
export const BAGS_PROXY_BASE_URL = hasProxyBaseUrl() ? `${PROXY_CONFIG.BASE_URL}/bags` : '';
export const hasBagsProxy = (): boolean => BAGS_PROXY_BASE_URL.trim().length > 0;

/** Bags UI token page (share with community). */
export function getBagsTokenPageUrl(tokenMint: string): string {
  const m = tokenMint.trim();
  return `https://bags.fm/${m}`;
}

/** Bags API / partner limits for launch metadata (align form validation). */
export const MAX_BAGS_TOKEN_NAME_LEN = 32;
export const MAX_BAGS_TOKEN_SYMBOL_LEN = 10;
export const MAX_BAGS_TOKEN_DESCRIPTION_LEN = 1000;

/** Default Meteora fee mode for new launches (Bags API). */
export const BAGS_DEFAULT_FEE_CONFIG_TYPE = 'fa29606e-5e48-4c37-827f-4b03d58ee23d' as const;

/** Grouped config for client. Secrets are injected by the proxy. */
export const BAGS_CONFIG = {
  BASE_URL: BAGS_BASE_URL,
  PROXY_BASE_URL: BAGS_PROXY_BASE_URL,
} as const;

/** Launch needs proxy configured (worker injects Bags key). */
export const isBagsLaunchConfigured = (): boolean => hasBagsProxy();
