import { TokenRegistryService } from './TokenRegistryService';
import { PriceService } from './PriceService';

export type TokenMeta = {
  mint: string;
  symbol: string;
  name: string;
  iconUrl?: string;
  decimals?: number;
  priceUsd?: number;
};

// Known tokens fallback map (Popular Assets)
const KNOWN_TOKENS: Record<string, Partial<TokenMeta>> = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', name: 'Solana', decimals: 9, iconUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin', decimals: 6, iconUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'USDT', decimals: 6, iconUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { symbol: 'JUP', name: 'Jupiter', decimals: 6, iconUrl: 'https://static.jup.ag/jup/icon.png' },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', name: 'Bonk', decimals: 5, iconUrl: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr': { symbol: 'POPCAT', name: 'Popcat', decimals: 9, iconUrl: 'https://arweave.net/1h-bXQpT6s6p8I8aQ5h_j5h_j5h_j5h_j5h_j5h_j5h' }, 
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3': { symbol: 'SEEKER', name: 'Seeker', decimals: 9 },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', name: 'Marinade Staked SOL', decimals: 9, iconUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png' },
};

// In-memory cache
const metaCache = new Map<string, TokenMeta>();

export const AssetMetadataService = {
  /**
   * Resolve metadata and PRICES for a list of mints.
   * Prioritizes local known tokens, then cached, then fetches from Jupiter/Registry.
   * Uses PriceService for prices.
   */
  async resolveMetadata(mints: string[]): Promise<Record<string, TokenMeta>> {
    const result: Record<string, TokenMeta> = {};
    const toFetchMeta: string[] = [];
    const allMintsForPrice = [...mints];

    // 1. Resolve Metadata (Name/Symbol/Logo)
    for (const mint of mints) {
      if (KNOWN_TOKENS[mint]) {
        const known = KNOWN_TOKENS[mint];
        const meta: TokenMeta = {
          mint,
          symbol: known.symbol || 'Unknown',
          name: known.name || 'Unknown Token',
          decimals: known.decimals,
          iconUrl: known.iconUrl,
          priceUsd: 0, // Default to 0, will update later
        };
        metaCache.set(mint, meta);
        result[mint] = meta;
        continue;
      }

      if (metaCache.has(mint)) {
        result[mint] = metaCache.get(mint)!;
        continue;
      }

      toFetchMeta.push(mint);
    }

    // 2. Fetch missing metadata
    if (toFetchMeta.length > 0) {
      const chunkSize = 5;
      for (let i = 0; i < toFetchMeta.length; i += chunkSize) {
        const chunk = toFetchMeta.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (mint) => {
          try {
            let meta: TokenMeta | null = null;
            const registryItem = await TokenRegistryService.getByMint(mint);
            
            if (registryItem) {
               meta = {
                 mint,
                 symbol: registryItem.symbol,
                 name: registryItem.name,
                 decimals: registryItem.decimals,
                 iconUrl: registryItem.logoURI,
                 priceUsd: 0
               };
            } else {
               meta = {
                 mint,
                  symbol: 'Unknown',
                 name: 'Unknown Token',
                 priceUsd: 0
               };
            }
            
            if (meta) {
               metaCache.set(mint, meta);
               result[mint] = meta;
            }
          } catch (e) {
            console.warn(`Metadata fetch failed for ${mint}`, e);
          }
        }));
        if (i + chunkSize < toFetchMeta.length) await new Promise(r => setTimeout(r, 100));
      }
    }

    // 3. Fetch Prices using PriceService (Delegated)
    try {
       // Ensure SOL is always included in price fetch if not present
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      if (!allMintsForPrice.includes(SOL_MINT)) {
         allMintsForPrice.push(SOL_MINT);
      }
      
      const prices = await PriceService.getTokenUsdPrices(allMintsForPrice);
      
      // Update results and cache with prices
      Object.keys(prices).forEach(mint => {
         const price = prices[mint];
         if (result[mint]) {
            result[mint].priceUsd = price;
         }
         
         const cached = metaCache.get(mint);
         if (cached) {
            cached.priceUsd = price;
            metaCache.set(mint, cached);
         }
      });
      
    } catch (e) {
      console.warn('Price fetch delegation failed', e);
    }

    return result;
  },

  /**
   * Get a single token's metadata (cached or fetched)
   */
  async getMetadata(mint: string): Promise<TokenMeta | null> {
    const res = await this.resolveMetadata([mint]);
    return res[mint] || null;
  }
};
