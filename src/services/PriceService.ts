import { PROXY_CONFIG, hasProxyBaseUrl } from '../config/proxy';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// In-memory cache
type PriceCacheEntry = {
  price: number;
  timestamp: number;
};
const priceCache = new Map<string, PriceCacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export const PriceService = {
  /**
   * Get USD prices for a list of mints.
   * Prioritizes Jupiter V2, falls back to CoinGecko, then cache.
   */
  getTokenUsdPrices: async (mints: string[]): Promise<Record<string, number>> => {
    if (mints.length === 0) return {};
    
    const results: Record<string, number> = {};
    const now = Date.now();
    const missingMints: string[] = [];

    // 1. Check Cache
    for (const mint of mints) {
      const cached = priceCache.get(mint);
      if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        results[mint] = cached.price;
      } else {
        missingMints.push(mint);
      }
    }

    if (missingMints.length === 0) return results;

    // 2. Fetch from proxy (worker injects API key server-side)
    // Price API V3 supports up to 50 ids per request.
    const chunkSize = 50;
    const jupiterPriceProxyBase = hasProxyBaseUrl() ? `${PROXY_CONFIG.BASE_URL}/jupiter/price/v3` : '';
    for (let i = 0; i < missingMints.length; i += chunkSize) {
      const chunk = missingMints.slice(i, i + chunkSize);
      const ids = chunk.join(',');
      
      try {
        if (!jupiterPriceProxyBase) break;
        const url = `${jupiterPriceProxyBase}?ids=${encodeURIComponent(ids)}`;
        const res = await fetch(url);
        
        if (res.ok) {
          const json = await res.json();
          // V3 returns { [mint]: { usdPrice: number|string, ... } }
          for (const mint of chunk) {
            const item = json?.[mint];
            const usdPrice = item?.usdPrice;
            if (usdPrice != null) {
              const price = typeof usdPrice === 'string' ? parseFloat(usdPrice) : Number(usdPrice);
              if (!Number.isNaN(price)) {
                results[mint] = price;
                priceCache.set(mint, { price, timestamp: now });
              }
            }
          }
        }
      } catch (e) {
        console.warn('Jupiter price fetch failed for chunk', e);
      }
    }

    // 3. Fallback to CoinGecko for anything still missing (especially SOL if Jupiter failed)
    const stillMissing = missingMints.filter((m) => results[m] === undefined);
    if (stillMissing.length > 0) {
       // Only try CoinGecko for major tokens to avoid rate limits on random mints
       const isSolMissing = stillMissing.includes(SOL_MINT);
       if (isSolMissing) {
          try {
             const url = `${COINGECKO_API}/simple/price?ids=solana&vs_currencies=usd`;
             const res = await fetch(url);
             if (res.ok) {
                const data = await res.json();
                if (data.solana?.usd) {
                   const price = data.solana.usd;
                   results[SOL_MINT] = price;
                   priceCache.set(SOL_MINT, { price, timestamp: now });
                }
             }
          } catch (e) { console.warn('CG SOL fetch failed', e); }
       }
    }

    // 4. Stablecoin hardcoded fallback if absolutely everything failed
    if (mints.includes(USDC_MINT) && results[USDC_MINT] === undefined) results[USDC_MINT] = 1.0;
    if (mints.includes(USDT_MINT) && results[USDT_MINT] === undefined) results[USDT_MINT] = 1.0;

    // 5. Fill remaining with 0 (or last known cache if expired?)
    // Requirement says: "if no price exists, treat as unpriced and usdValue = 0"
    // But also: "use a local cached last-known price" -> we imply checking expired cache here?
    // Let's check expired cache for missing ones
    for (const mint of stillMissing) {
       if (results[mint] === undefined) {
          const cached = priceCache.get(mint);
          if (cached) {
             // Use expired cache as last resort
             results[mint] = cached.price;
          } else {
             results[mint] = 0;
          }
       }
    }

    return results;
  },

  getSolUsdPrice: async (): Promise<number> => {
    const prices = await PriceService.getTokenUsdPrices([SOL_MINT]);
    return prices[SOL_MINT] || 0;
  }
};
