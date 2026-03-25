import { Connection, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { DflowSwapService } from './DflowSwapService';
import { isDflowConfigured } from '../config/dflow';
import { JupiterTokenService } from './JupiterTokenService';
import { getConnection } from './SolanaService';

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
let dflowDecimalsCache: Map<string, number> | null = null;
const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

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
    const conn = getConnection();
    const mintPubkey = new PublicKey(mint);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      METADATA_PROGRAM_ID
    );

    const info = await conn.getAccountInfo(pda);
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

    // Try to fetch JSON from URI for Logo.
    // Bags metadata commonly uses IPFS gateways; on mobile, `ipfs.io` fetches may intermittently fail.
    if (uri && uri.startsWith('http')) {
      const candidateUris = new Set<string>([uri]);
      const ipfsPrefix = 'https://ipfs.io/ipfs/';
      if (uri.startsWith(ipfsPrefix)) {
        const cid = uri.slice(ipfsPrefix.length);
        candidateUris.add(`https://cloudflare-ipfs.com/ipfs/${cid}`);
        candidateUris.add(`https://gateway.pinata.cloud/ipfs/${cid}`);
      }

      for (const candidate of candidateUris) {
        try {
          const jsonRes = await fetchWithRetry(candidate);
          if (!jsonRes.ok) continue;
          const json = (await jsonRes.json()) as any;

          const img =
            (typeof json?.image === 'string' && json.image.trim()) ||
            (typeof json?.imageUrl === 'string' && json.imageUrl.trim()) ||
            (typeof json?.image_url === 'string' && json.image_url.trim());

          if (img) {
            logoURI = img;
            break;
          }
        } catch {
          // Try next gateway
        }
      }
    }

    // Try to get decimals from Mint Account
    try {
       const mintInfo = await conn.getParsedAccountInfo(mintPubkey);
       if (mintInfo.value && 'parsed' in mintInfo.value.data) {
          decimals = mintInfo.value.data.parsed.info.decimals;
       }
    } catch (e) {
      // Ignore
    }

    return {
      address: mint,
      symbol: typeof symbol === 'string' && symbol.trim().length > 0 ? symbol.trim() : 'Unknown',
      name: typeof name === 'string' && name.trim().length > 0 ? name.trim() : 'Unknown Token',
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
    if (byMintCache.has(mint)) {
      return byMintCache.get(mint) ?? null;
    }

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

    // 2. Try Jupiter strict token list (single endpoint, fewer failures)
    try {
      const list = await JupiterTokenService.getStrictList();
      const found = list.find((t) => t.mint === mint);
      if (found) {
        const t: TokenRegistryItem = {
          address: mint,
          symbol: typeof found.symbol === 'string' && found.symbol.trim().length > 0 ? found.symbol.trim() : 'Unknown',
          name: typeof found.name === 'string' && found.name.trim().length > 0 ? found.name.trim() : 'Unknown Token',
          decimals: found.decimals ?? 9,
          logoURI: found.iconUrl,
        };
        byMintCache.set(mint, t);
        return t;
      }
    } catch (e) {
      // If strict list fails, fall through to per-mint and on-chain.
    }

    // 2b. Per-mint fallback (more likely to succeed than the full strict list)
    try {
      const res = await fetchWithRetry(`https://tokens.jup.ag/token/${mint}`);
      if (res.ok) {
        const t = (await res.json()) as Partial<TokenRegistryItem> & { address?: string };
        if (t && typeof t.address === 'string') {
          const full: TokenRegistryItem = {
            address: mint,
            symbol: typeof t.symbol === 'string' && t.symbol.trim().length > 0 ? t.symbol.trim() : 'Unknown',
            name: typeof t.name === 'string' && t.name.trim().length > 0 ? t.name.trim() : 'Unknown Token',
            decimals: typeof t.decimals === 'number' ? t.decimals : 9,
            logoURI: t.logoURI,
          };
          byMintCache.set(mint, full);
          return full;
        }
      }
    } catch {
      // ignore — continue to DFLOW/on-chain fallbacks
    }
    
    // 3. Fallback to On-Chain Metadata (best chance for real symbol/name)
    // If API failed (network/rate limit/unknown token), try reading from Solana directly.
    const onChain = await fetchOnChainMetadata(mint);
    if (onChain) {
       byMintCache.set(mint, onChain);
       return onChain;
    }

    // 4. Try DFLOW token decimals as last fallback (only when configured).
    if (isDflowConfigured()) {
      try {
        if (!dflowDecimalsCache) {
          const tokens = await DflowSwapService.getTokensWithDecimals();
          dflowDecimalsCache = new Map(tokens);
        }
        const dflowDecimals = dflowDecimalsCache.get(mint);
        if (typeof dflowDecimals === 'number') {
          const dflowMeta: TokenRegistryItem = {
            address: mint,
            symbol: 'Unknown',
            name: `Token ${mint.slice(0, 6)}`,
            decimals: dflowDecimals,
          };
          byMintCache.set(mint, dflowMeta);
          return dflowMeta;
        }
      } catch {
        // Silently skip — DFLOW is optional fallback
      }
    }

    byMintCache.set(mint, null);
    return null;
  },
};
