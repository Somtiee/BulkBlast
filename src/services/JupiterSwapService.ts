import { VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { JUPITER_CONFIG, hasJupiterApiKey } from '../config/jupiter';

// Official V1 API Base URL
const JUPITER_API_BASE = JUPITER_CONFIG.BASE_URL;

export type QuoteResponse = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: any;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot?: number;
  timeTaken?: number;
};

// Diagnostic result to pass to UI if needed (for debug)
export let lastRequestDiagnostics: {
  url: string;
  status: number;
  error?: string;
  apiKeyPresent: boolean;
} | null = null;

async function fetchWithDiagnostics(
  url: string,
  init?: RequestInit,
  retries = 1, // Reduced retries for speed, but keep 1 for transient network
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  const headers = new Headers(init?.headers);
  // Add API Key header if available
  if (hasJupiterApiKey()) {
    headers.set('x-api-key', JUPITER_CONFIG.API_KEY);
  }
  // Ensure JSON content type for POST
  if (init?.method === 'POST') {
    headers.set('Content-Type', 'application/json');
  }

  const config = {
    ...init,
    headers,
    signal: controller.signal
  };

  // Reset diagnostics
  lastRequestDiagnostics = {
    url,
    status: 0,
    apiKeyPresent: hasJupiterApiKey(),
  };

  try {
    const res = await fetch(url, config);
    clearTimeout(timeoutId);
    
    lastRequestDiagnostics.status = res.status;

    // Diagnostics
    if (!res.ok) {
      let errorBody = '';
      try { errorBody = await res.text(); } catch {}
      lastRequestDiagnostics.error = errorBody.slice(0, 200);

      if (res.status === 429) {
        throw new Error('Jupiter Rate Limit (429). Please try again later.');
      }
      if (res.status === 401) {
         throw new Error('Jupiter API Key Invalid or Missing (401). Please check app config.');
      }
      if (res.status === 400) {
         // Try to parse validation error
         let reason = errorBody;
         try {
           const json = JSON.parse(errorBody);
           if (json.error) reason = json.error;
           if (json.message) reason = json.message;
         } catch {}
         throw new Error(`Invalid Request (400): ${reason}`);
      }
      if (res.status >= 500) {
        if (retries > 0) {
           await new Promise(r => setTimeout(r, 1000));
           return fetchWithDiagnostics(url, init, retries - 1, timeoutMs);
        }
        throw new Error(`Jupiter Service Error (${res.status})`);
      }
      
      throw new Error(`Jupiter API Error ${res.status}: ${errorBody.slice(0, 100)}`);
    }

    return res;
  } catch (e: any) {
    clearTimeout(timeoutId);
    
    // Network / Timeout Handling
    if (e.name === 'AbortError') {
       throw new Error('Jupiter Request Timed Out (12s)');
    }
    
    if (e.message.includes('Network') || e.message.includes('failed to fetch')) {
       if (retries > 0) {
          await new Promise(r => setTimeout(r, 1000));
          return fetchWithDiagnostics(url, init, retries - 1, timeoutMs);
       }
       throw new Error('Network Connection Failed. Please check internet.');
    }
    
    throw e;
  }
}

export const JupiterSwapService = {
  getQuote: async ({
    inputMint,
    outputMint,
    amountLamports,
    slippageBps = 50, // 0.5% default
  }: {
    inputMint: string;
    outputMint: string;
    amountLamports: string;
    slippageBps?: number;
  }): Promise<QuoteResponse> => {
    // Basic validation
    if (!inputMint || !outputMint) throw new Error('Missing input or output mint');
    if (inputMint === outputMint) throw new Error('Cannot swap same token');
    if (!amountLamports || parseInt(amountLamports) <= 0) throw new Error('Invalid amount');

    const url = `${JUPITER_API_BASE}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`;
    
    const response = await fetchWithDiagnostics(url);
    const data = await response.json();
    return data;
  },

  getSwapTransaction: async ({
    quoteResponse,
    userPublicKey,
    wrapAndUnwrapSol = true,
    dynamicComputeUnitLimit = true,
    prioritizationFeeLamports = 'auto',
  }: {
    quoteResponse: QuoteResponse;
    userPublicKey: string;
    wrapAndUnwrapSol?: boolean;
    dynamicComputeUnitLimit?: boolean;
    prioritizationFeeLamports?: string | number;
  }): Promise<{ swapTransactionBase64: string }> => {
    const response = await fetchWithDiagnostics(`${JUPITER_API_BASE}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey,
        wrapAndUnwrapSol,
        dynamicComputeUnitLimit,
        prioritizationFeeLamports,
      }),
    });

    const { swapTransaction } = await response.json();
    return { swapTransactionBase64: swapTransaction };
  },

  deserializeSwapTransaction: (base64: string): VersionedTransaction => {
    const buffer = Buffer.from(base64, 'base64');
    return VersionedTransaction.deserialize(buffer);
  },
};
