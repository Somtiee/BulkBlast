import { getNetwork } from './SolanaService';
import { TOKENS } from '../config/tokens';
import { PriceService } from './PriceService';

// Fallback placeholder rate when live price fails
const FALLBACK_PRICE_USD = 0.022;

export type FeeTier = 'T1' | 'T2' | 'T3';

export const FeeService = {
  getTier(recipientCount: number): FeeTier {
    if (recipientCount < 50) return 'T1';
    if (recipientCount < 500) return 'T2';
    return 'T3';
  },

  computeFeeUsd(recipientCount: number): number {
    return FeeService.computeFeeUsdByToken(recipientCount, 'SKR');
  },

  computeFeeUsdByToken(recipientCount: number, token: 'SKR' | 'SOL'): number {
    // Waive fees on Devnet
    if (getNetwork() !== 'mainnet-beta') return 0;

    const tier = FeeService.getTier(recipientCount);
    if (token === 'SOL') {
      switch (tier) {
        case 'T1': return 0.065;
        case 'T2': return 0.14;
        case 'T3': return 0.3;
      }
    }
    switch (tier) {
      case 'T1': return 0.05;
      case 'T2': return 0.1;
      case 'T3': return 0.2;
    }
  },

  applyDiscount(feeUsd: number, seekerDiscountEnabled: boolean): number {
    if (!seekerDiscountEnabled) return feeUsd;
    return feeUsd * 0.5; // 50% off
  },

  async getFeeInSeekerTokens(
    feeUsd: number,
    feeTokenMint?: string
  ): Promise<{ feeTokens: string; rateUsdPerToken: string }> {
    let usdPerToken = FALLBACK_PRICE_USD;
    try {
      if (feeTokenMint) {
        const url = `https://price.jup.ag/v4/price?ids=${encodeURIComponent(feeTokenMint)}&vsToken=USD`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          const data = json?.data;
          const entry = data?.[feeTokenMint];
          const price = entry?.price;
          if (typeof price === 'number' && price > 0) {
            usdPerToken = price;
          }
        }
      }
    } catch {}
    const tokens = feeUsd / usdPerToken;
    return {
      feeTokens: tokens.toFixed(6),
      rateUsdPerToken: usdPerToken.toString(),
    };
  },

  async getFeeInToken(
    feeUsd: number,
    feeTokenMint: string
  ): Promise<{ feeAmountUi: string; rateUsdPerToken: string }> {
    let usdPerToken = feeTokenMint === TOKENS.SOL.mint ? 180 : FALLBACK_PRICE_USD;
    try {
      const prices = await PriceService.getTokenUsdPrices([feeTokenMint]);
      const live = prices[feeTokenMint];
      if (typeof live === 'number' && live > 0) {
        usdPerToken = live;
      }
    } catch {}

    const amount = feeUsd / usdPerToken;
    return {
      feeAmountUi: amount.toFixed(6),
      rateUsdPerToken: usdPerToken.toString(),
    };
  },
};
