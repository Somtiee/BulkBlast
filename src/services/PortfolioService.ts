import { PublicKey } from '@solana/web3.js';
import * as FileSystem from 'expo-file-system/legacy';
import { getWalletPortfolio, type TokenBalance } from './SolanaService';
import { AssetMetadataService } from './AssetMetadataService';
import { PriceService } from './PriceService';

export type PortfolioAsset = {
  mint: string;
  symbol: string;
  name: string;
  balanceUi: string;
  decimals: number;
  usdPrice: number;
  usdValue: number;
  iconUrl?: string;
  kind: 'SOL' | 'SPL';
};

export type PortfolioSnapshot = {
  totalUsd: number;
  assets: PortfolioAsset[];
  rawNfts: TokenBalance[];
  cachedAt?: number;
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const CACHE_VERSION = 2;

function cacheFilePath(owner: string): string {
  return `${FileSystem.cacheDirectory}portfolio_${owner.slice(0, 8)}.json`;
}

export const PortfolioService = {
  loadCachedSnapshot: async (ownerPublicKey: string): Promise<PortfolioSnapshot | null> => {
    try {
      const path = cacheFilePath(ownerPublicKey);
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      const raw = await FileSystem.readAsStringAsync(path);
      const parsed = JSON.parse(raw) as PortfolioSnapshot;
      if (!parsed || !Array.isArray(parsed.assets)) return null;
      // Accept legacy cache snapshots for UX (balance shouldn't flash 0.0).
      // If cacheVersion is missing or older, still use it and refresh immediately.
      if (typeof (parsed as any).cacheVersion !== 'number') return parsed;
      if ((parsed as any).cacheVersion !== CACHE_VERSION) return parsed;
      return parsed;
    } catch {
      return null;
    }
  },

  saveCachedSnapshot: async (ownerPublicKey: string, snapshot: PortfolioSnapshot): Promise<void> => {
    try {
      const path = cacheFilePath(ownerPublicKey);
      const toSave: PortfolioSnapshot & { cacheVersion: number } = { ...snapshot, cachedAt: Date.now(), cacheVersion: CACHE_VERSION };
      await FileSystem.writeAsStringAsync(path, JSON.stringify(toSave));
    } catch {
      // Non-critical — ignore write failures
    }
  },

  getPortfolioSnapshot: async (ownerPublicKey: string): Promise<PortfolioSnapshot> => {
    // 1. Fetch Balances via SolanaService (which handles SOL, SPL, and basic NFT separation)
    // We pass a dummy fee mint if not available, or update getWalletPortfolio to make it optional
    // Currently getWalletPortfolio requires feeTokenMint. Let's pass SEEKER mint as default or empty string.
    const SEEKER_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
    const portfolio = await getWalletPortfolio(ownerPublicKey, SEEKER_MINT);

    // 2. Prepare Asset List (SOL + SPL)
    const assets: Partial<PortfolioAsset>[] = [];

    // Add SOL
    assets.push({
      mint: SOL_MINT,
      kind: 'SOL',
      balanceUi: portfolio.sol,
      decimals: 9,
      symbol: 'SOL',
      name: 'Solana',
    });

    // Add SPLs — keep symbol from getWalletPortfolio as baseline fallback.
    for (const t of portfolio.tokens) {
      assets.push({
        mint: t.mint,
        kind: 'SPL',
        balanceUi: t.balance,
        decimals: t.decimals,
        symbol: t.symbol && t.symbol !== 'Unknown' ? t.symbol : undefined,
      } as any);
    }

    // 3. Resolve Metadata & Prices with generous timebox so UI stays responsive.
    const allMints = assets.map(a => a.mint!);

    const [metadataMap, priceMap] = await Promise.all([
      withTimeout<Record<string, any>>(AssetMetadataService.resolveMetadata(allMints), 15000, {}),
      withTimeout<Record<string, number>>(PriceService.getTokenUsdPrices(allMints), 12000, {}),
    ]);

    // 4. Merge Data — prefer metadata, then wallet-level symbol, then generic fallback.
    const finalAssets: PortfolioAsset[] = assets.map(asset => {
      const mint = asset.mint!;
      const meta = metadataMap[mint];
      const price = priceMap[mint] || 0;
      const balance = parseFloat(asset.balanceUi || '0');
      const walletSymbol = (asset as any).symbol as string | undefined;
      
      return {
        mint,
        kind: asset.kind!,
        balanceUi: asset.balanceUi!,
        decimals: asset.decimals!,
        symbol: meta?.symbol || walletSymbol || (asset.kind === 'SOL' ? 'SOL' : mint.slice(0, 4) + '...' + mint.slice(-4)),
        name: meta?.name || (asset.kind === 'SOL' ? 'Solana' : walletSymbol || 'Token'),
        iconUrl: meta?.iconUrl,
        usdPrice: price,
        usdValue: balance * price
      };
    });

    // 5. Sort Assets
    // 1. SOL first if value > 0
    // 2. Value Descending
    finalAssets.sort((a, b) => {
       if (a.kind === 'SOL' && b.kind !== 'SOL') return -1;
       if (a.kind !== 'SOL' && b.kind === 'SOL') return 1;
       
       const diff = b.usdValue - a.usdValue;
       if (Math.abs(diff) > 0.01) return diff;
       
       return a.symbol.localeCompare(b.symbol);
    });

    // Calculate Total
    const totalUsd = finalAssets.reduce((sum, a) => sum + a.usdValue, 0);

    const snapshot: PortfolioSnapshot = {
      totalUsd,
      assets: finalAssets,
      rawNfts: portfolio.nfts,
      cachedAt: Date.now(),
    };

    PortfolioService.saveCachedSnapshot(ownerPublicKey, snapshot);

    return snapshot;
  }
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
  } catch {
    return fallback;
  }
}
