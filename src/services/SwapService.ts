export function getSwapProvider() {
  return { id: 'jupiter_like_stub' as const };
}

export async function quoteSwap(_: { from: string; to: string; amount: number }) {
  return { priceImpact: 0.01, minReceived: 0.99 };
}

export async function executeSwap(_: { from: string; to: string; amount: number }) {
  return { txId: 'SWAP_TX_STUB' };
}
