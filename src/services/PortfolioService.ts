import { PublicKey } from '@solana/web3.js';
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
};

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export const PortfolioService = {
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
    });

    // Add SPLs
    for (const t of portfolio.tokens) {
      // Filter out zero balance if not already handled? getWalletPortfolio handles most.
      // Also filter out things that look like NFTs but slipped through?
      // getWalletPortfolio logic: decimals === 0 && uiAmount >= 1 -> NFT.
      // So these are fungibles.
      assets.push({
        mint: t.mint,
        kind: 'SPL',
        balanceUi: t.balance,
        decimals: t.decimals,
      });
    }

    // 3. Resolve Metadata & Prices
    const allMints = assets.map(a => a.mint!);
    
    // Fetch Metadata and Prices in parallel
    const [metadataMap, priceMap] = await Promise.all([
      AssetMetadataService.resolveMetadata(allMints),
      PriceService.getTokenUsdPrices(allMints)
    ]);

    // 4. Merge Data
    const finalAssets: PortfolioAsset[] = assets.map(asset => {
      const mint = asset.mint!;
      const meta = metadataMap[mint];
      const price = priceMap[mint] || 0;
      const balance = parseFloat(asset.balanceUi || '0');
      
      return {
        mint,
        kind: asset.kind!,
        balanceUi: asset.balanceUi!,
        decimals: asset.decimals!,
        symbol: meta?.symbol || (asset.kind === 'SOL' ? 'SOL' : 'Unknown'),
        name: meta?.name || (asset.kind === 'SOL' ? 'Solana' : 'Unknown Token'),
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

    return {
      totalUsd,
      assets: finalAssets,
      rawNfts: portfolio.nfts
    };
  }
};
