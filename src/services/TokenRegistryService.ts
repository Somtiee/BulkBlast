import { Connection, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

export type TokenRegistryItem = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

// Fallback metadata for common tokens if API fails
const LOCAL_TOKEN_MAP: Record<string, Partial<TokenRegistryItem>> = {
  'So11111111111111111111111111111111111111112': { symbol: 'SOL', name: 'Solana', decimals: 9, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' },
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', name: 'USD Coin', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', name: 'USDT', decimals: 6, logoURI: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': { symbol: 'JUP', name: 'Jupiter', decimals: 6, logoURI: 'https://static.jup.ag/jup/icon.png' },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', name: 'Bonk', decimals: 5, logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr': { symbol: 'POPCAT', name: 'Popcat', decimals: 9, logoURI: 'https://arweave.net/1h-bXQpT6s6p8I8aQ5h_j5h_j5h_j5h_j5h_j5h_j5h' }, 
  'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3': { symbol: 'SEEKER', name: 'Seeker', decimals: 9 },
};

const byMintCache = new Map<string, TokenRegistryItem | null>();
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// Use a fallback RPC connection for metadata fetching if needed
// This is a free public RPC, but robust enough for metadata reads
const FALLBACK_CONNECTION = new Connection('https://api.mainnet-beta.solana.com');

async function fetchWithRetry(url: string, retries = 2, delayMs = 500): Promise<Response> {
  try {
    const res = await fetch(url);
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, retries - 1, delayMs * 2);
    }
    return res;
  } catch (e) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
      return fetchWithRetry(url, retries - 1, delayMs * 2);
    }
    throw e;
  }
}

// Minimal On-Chain Metadata Parser
async function fetchOnChainMetadata(mint: string): Promise<TokenRegistryItem | null> {
  try {
    const mintPubkey = new PublicKey(mint);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      METADATA_PROGRAM_ID
    );

    const info = await FALLBACK_CONNECTION.getAccountInfo(pda);
    if (!info) return null;

    // Skip first 1 + 32 + 32 = 65 bytes (Key, UpdateAuth, Mint)
    let offset = 65;
    
    // Read Name
    const nameLen = info.data.readUInt32LE(offset);
    offset += 4;
    const name = info.data.slice(offset, offset + nameLen).toString('utf8').replace(/\0/g, '').trim();
    offset += nameLen;

    // Read Symbol
    const symbolLen = info.data.readUInt32LE(offset);
    offset += 4;
    const symbol = info.data.slice(offset, offset + symbolLen).toString('utf8').replace(/\0/g, '').trim();
    offset += symbolLen;

    // Read URI
    const uriLen = info.data.readUInt32LE(offset);
    offset += 4;
    const uri = info.data.slice(offset, offset + uriLen).toString('utf8').replace(/\0/g, '').trim();
    
    let logoURI: string | undefined;
    let decimals = 9; // Default if not found elsewhere (usually need to fetch Mint Account for this)

    // Try to fetch JSON from URI for Logo
    if (uri && uri.startsWith('http')) {
      try {
        const jsonRes = await fetchWithRetry(uri);
        if (jsonRes.ok) {
           const json = await jsonRes.json();
           if (json.image) logoURI = json.image;
        }
      } catch (e) {
        // Ignore URI fetch failure
      }
    }

    // Try to get decimals from Mint Account
    try {
       const mintInfo = await FALLBACK_CONNECTION.getParsedAccountInfo(mintPubkey);
       if (mintInfo.value && 'parsed' in mintInfo.value.data) {
          decimals = mintInfo.value.data.parsed.info.decimals;
       }
    } catch (e) {
      // Ignore
    }

    return {
      address: mint,
      symbol: symbol || 'Unknown',
      name: name || 'Unknown Token',
      decimals,
      logoURI
    };

  } catch (e) {
    console.warn('On-chain metadata fetch failed', e);
    return null;
  }
}

export const TokenRegistryService = {
  async getByMint(mint: string): Promise<TokenRegistryItem | null> {
    const cached = byMintCache.get(mint);
    if (cached) return cached; 

    // 1. Check Local Fallback first (instant)
    if (LOCAL_TOKEN_MAP[mint]) {
       const local = LOCAL_TOKEN_MAP[mint];
       const full: TokenRegistryItem = {
         address: mint,
         symbol: local.symbol!,
         name: local.name!,
         decimals: local.decimals || 9,
         logoURI: local.logoURI,
       };
       byMintCache.set(mint, full);
       return full;
    }

    // 2. Try Jupiter Token API (Fastest)
    try {
      const res = await fetchWithRetry(`https://tokens.jup.ag/token/${mint}`);
      if (res.ok) {
        const t = (await res.json()) as TokenRegistryItem;
        if (t && typeof t.address === 'string') {
          byMintCache.set(mint, t);
          return t;
        }
      }
    } catch (e) {
      console.warn(`Token registry fetch failed for ${mint}`, e);
    }
    
    // 3. Fallback to On-Chain Metadata (Robust)
    // If API failed (network/rate limit/unknown token), try reading from Solana directly.
    const onChain = await fetchOnChainMetadata(mint);
    if (onChain) {
       byMintCache.set(mint, onChain);
       return onChain;
    }

    return null;
  },
};
