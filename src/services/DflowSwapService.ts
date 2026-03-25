import { Buffer } from 'buffer';
import { VersionedTransaction } from '@solana/web3.js';
import { DFLOW_CONFIG, hasDflowProxy } from '../config/dflow';

export type DflowQuoteResponse = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot?: number;
  requestId?: string;
};

export type DflowSwapResponse = {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
  computeUnitLimit: number;
};

export let lastDflowRequestDiagnostics: {
  url: string;
  status: number;
  error?: string;
  apiKeyPresent: boolean;
  usingProxy: boolean;
} | null = null;

function baseUrl() {
  return hasDflowProxy() ? DFLOW_CONFIG.PROXY_URL : DFLOW_CONFIG.BASE_URL;
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  return headers;
}

async function fetchDflow(url: string, init?: RequestInit): Promise<Response> {
  const headers = buildHeaders(init?.headers);
  if (init?.method === 'POST') headers.set('Content-Type', 'application/json');

  lastDflowRequestDiagnostics = {
    url,
    status: 0,
    apiKeyPresent: false,
    usingProxy: hasDflowProxy(),
  };

  const res = await fetch(url, { ...init, headers });
  lastDflowRequestDiagnostics.status = res.status;

  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {}
    lastDflowRequestDiagnostics.error = body.slice(0, 250);
    throw new Error(`DFLOW API Error ${res.status}: ${body.slice(0, 140) || 'Unknown error'}`);
  }

  return res;
}

export const DflowSwapService = {
  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amountLamports: string;
    slippageBps?: number;
  }): Promise<DflowQuoteResponse> {
    const slippage = params.slippageBps ?? 50;
    const url =
      `${baseUrl()}/quote?inputMint=${params.inputMint}` +
      `&outputMint=${params.outputMint}` +
      `&amount=${params.amountLamports}` +
      `&slippageBps=${slippage}`;

    const res = await fetchDflow(url);
    return res.json();
  },

  async getSwapTransaction(params: {
    quoteResponse: DflowQuoteResponse;
    userPublicKey: string;
    wrapAndUnwrapSol?: boolean;
    dynamicComputeUnitLimit?: boolean;
    prioritizationFeeLamports?: string | number;
  }): Promise<{ swapTransactionBase64: string }> {
    const dynamicComputeUnitLimit = params.dynamicComputeUnitLimit ?? true;
    try {
      const res = await fetchDflow(`${baseUrl()}/swap`, {
        method: 'POST',
        body: JSON.stringify({
          quoteResponse: params.quoteResponse,
          userPublicKey: params.userPublicKey,
          wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
          dynamicComputeUnitLimit,
          prioritizationFeeLamports: params.prioritizationFeeLamports ?? 'auto',
        }),
      });

      const data = (await res.json()) as DflowSwapResponse;
      return { swapTransactionBase64: data.swapTransaction };
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      // DFLOW can fail simulation when computing dynamic CU limit.
      // Retry without dynamicComputeUnitLimit to make swaps more robust.
      if (dynamicComputeUnitLimit && (msg.includes('Simulation failed') || msg.includes('custom program error') || msg.includes('0x1'))) {
        const res = await fetchDflow(`${baseUrl()}/swap`, {
          method: 'POST',
          body: JSON.stringify({
            quoteResponse: params.quoteResponse,
            userPublicKey: params.userPublicKey,
            wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? true,
            dynamicComputeUnitLimit: false,
            prioritizationFeeLamports: params.prioritizationFeeLamports ?? 'auto',
          }),
        });
        const data = (await res.json()) as DflowSwapResponse;
        return { swapTransactionBase64: data.swapTransaction };
      }
      throw e;
    }
  },

  async getTokensWithDecimals(): Promise<Array<[string, number]>> {
    const res = await fetchDflow(`${baseUrl()}/tokens-with-decimals`);
    const json = (await res.json()) as Array<[string, number]>;
    return Array.isArray(json) ? json : [];
  },

  deserializeSwapTransaction(base64: string): VersionedTransaction {
    return VersionedTransaction.deserialize(Buffer.from(base64, 'base64'));
  },
};
