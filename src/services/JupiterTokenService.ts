import { TokenMeta } from './AssetMetadataService';
import { TOKENS } from '../config/tokens';

// Jupiter Token List API (Strict list for safety)
const JUP_TOKENS_API = 'https://token.jup.ag/strict'; 
// Use 'https://token.jup.ag/all' for full list if needed, but strict is safer/cleaner.

// Local Cache
let tokenListCache: TokenMeta[] = [];
let lastFetchTime = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export const JupiterTokenService = {
  /**
   * Fetch strict token list from Jupiter
   */
  async getStrictList(): Promise<TokenMeta[]> {
    const now = Date.now();
    if (tokenListCache.length > 0 && now - lastFetchTime < CACHE_TTL) {
      return tokenListCache;
    }

    try {
      const res = await fetch(JUP_TOKENS_API);
      if (!res.ok) throw new Error('Failed to fetch token list');
      
      const data: any[] = await res.json();
      
      // Map to our TokenMeta format
      const mapped = data.map(t => ({
        mint: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        iconUrl: t.logoURI,
      }));

      tokenListCache = mapped;
      lastFetchTime = now;
      return mapped;
    } catch (e) {
      // Avoid spamming network retries: cache the fallback for the TTL window.
      const fallback = Object.values(TOKENS);
      tokenListCache = fallback;
      lastFetchTime = now;
      return fallback;
    }
  },

  /**
   * Search tokens by query (symbol, name, mint)
   */
  async searchTokens(query: string): Promise<TokenMeta[]> {
    if (!query) return [];
    
    const list = await this.getStrictList();
    const q = query.toLowerCase().trim();

    // Direct Mint Match
    if (q.length > 30) {
       const exact = list.find(t => t.mint.toLowerCase() === q);
       if (exact) return [exact];
    }

    // Filter by Symbol/Name
    return list.filter(t => 
       t.symbol.toLowerCase().includes(q) || 
       t.name.toLowerCase().includes(q)
    ).slice(0, 20); // Limit results
  },

  /**
   * Get popular tokens (mix of local config + top traded)
   */
  async getPopularTokens(): Promise<TokenMeta[]> {
    // Return our curated list first
    return Object.values(TOKENS);
  }
};
