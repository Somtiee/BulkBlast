import { PROXY_CONFIG, hasProxyBaseUrl } from './proxy';

export const DFLOW_CONFIG = {
  BASE_URL: 'https://e.quote-api.dflow.net',
  /**
   * Client should use the proxy route (worker injects x-api-key).
   * Route mapping: /dflow/* -> https://e.quote-api.dflow.net/*
   */
  PROXY_URL: hasProxyBaseUrl() ? `${PROXY_CONFIG.BASE_URL}/dflow` : '',
};

export const hasDflowProxy = (): boolean => DFLOW_CONFIG.PROXY_URL.length > 0;

export const isDflowConfigured = (): boolean => hasDflowProxy();

// Backward-compatible export (client should never use DFLOW x-api-key directly anymore).
export const hasDflowApiKey = (): boolean => false;
