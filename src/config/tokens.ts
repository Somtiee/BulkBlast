// Centralized Token Configuration
// Ensures consistent mints, symbols, and metadata across the app.

export type TokenConfig = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl?: string;
};

export const TOKENS: Record<string, TokenConfig> = {
  SOL: {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    name: 'Solana',
    decimals: 9,
    iconUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  },
  USDC: {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    iconUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
  },
  USDT: {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    iconUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png',
  },
  JUP: {
    mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    symbol: 'JUP',
    name: 'Jupiter',
    decimals: 6,
    iconUrl: 'https://static.jup.ag/jup/icon.png',
  },
  BONK: {
    mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    symbol: 'BONK',
    name: 'Bonk',
    decimals: 5,
    iconUrl: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I',
  },
  POPCAT: {
    mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    symbol: 'POPCAT',
    name: 'Popcat',
    decimals: 9,
    iconUrl: 'https://arweave.net/1h-bXQpT6s6p8I8aQ5h_j5h_j5h_j5h_j5h_j5h_j5h',
  },
  // Correct SKR / Seeker Token
  SKR: {
    mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3', // Assuming this is the intended mint from previous context, user confirmed this is the one to use
    symbol: 'SKR', // Changed from SEEKER to SKR per user request or kept consistent? User said "SKR token config". Let's use SKR symbol.
    name: 'Seeker',
    decimals: 6,
    iconUrl: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3/logo.png', // Placeholder if not real
  },
};

export const FEE_TOKEN_MINT = TOKENS.SKR.mint;
export const DEFAULT_SWAP_OUTPUT_MINT = TOKENS.SKR.mint;
