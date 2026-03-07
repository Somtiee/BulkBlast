import { getNetwork } from './SolanaService';

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
    // Waive fees on Devnet
    if (getNetwork() !== 'mainnet-beta') return 0;

    const tier = FeeService.getTier(recipientCount);
    switch (tier) {
      case 'T1': return 0.5;
      case 'T2': return 1.0;
      case 'T3': return 2.0;
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
};
