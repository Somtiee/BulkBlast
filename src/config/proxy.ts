import { readExpoPublic } from '../utils/expoPublicEnv';

export const PROXY_CONFIG = {
  /**
   * Base URL of your proxy (e.g. Cloudflare Worker /api).
   * Example: https://bulkblast-proxy.yourname.workers.dev
   */
  BASE_URL: readExpoPublic('EXPO_PUBLIC_PROXY_BASE_URL'),
};

export const hasProxyBaseUrl = (): boolean => PROXY_CONFIG.BASE_URL.trim().length > 0;

