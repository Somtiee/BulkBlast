import { 
  Connection, 
  PublicKey, 
  LAMPORTS_PER_SOL, 
  Transaction, 
  TransactionInstruction, 
  SystemProgram, 
  sendAndConfirmTransaction
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import { signTransaction } from './WalletService';
import type { BuiltBatch } from './TransactionService';
import { getHeliusRpcUrl } from '../config/helius';

// Use a more robust RPC endpoint list (rotating public endpoints)
// Added more public endpoints to reduce load on a single one
const RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
  'https://rpc.ankr.com/solana',
  'https://api.tatum.io/v3/blockchain/node/solana-mainnet',
];

let currentRpcIndex = 0;
let connection: Connection | null = null;
let lastRpcRotateTime = 0;

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export type TokenBalance = {
  symbol: string;
  mint: string;
  balance: string;
  decimals: number;
  uri?: string;
};

export type WalletPortfolio = {
  sol: string;
  tokens: TokenBalance[];
  nfts: TokenBalance[];
};

export function setNetwork(network: 'mainnet-beta' | 'devnet') {
  currentNetwork = network;
  // currentRpcUrl = network === 'mainnet-beta' ? DEFAULT_RPC_URL : DEVNET_RPC_URL;
  connection = null; // Force reconnection
}

export function getNetwork() {
  return currentNetwork;
}

const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';
const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

let currentNetwork: 'mainnet-beta' | 'devnet' = 'mainnet-beta';

export function getConnection(): Connection {
  if (!connection) {
    // 1. Try Helius Config First
    const heliusUrl = getHeliusRpcUrl(currentNetwork);
    if (heliusUrl) {
      connection = new Connection(heliusUrl, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000,
      });
      return connection;
    }

    // 2. Fallback to Public/Rotating RPCs
    const url = currentNetwork === 'mainnet-beta' ? RPC_ENDPOINTS[currentRpcIndex] : DEVNET_RPC_URL;
    connection = new Connection(url, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });
  }
  return connection;
}

import { Logger } from '../utils/Logger';

// Simple retry wrapper for RPC calls with Exponential Backoff + Rotation
async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && (error?.message?.includes('429') || error?.message?.includes('network') || error?.message?.includes('fetch'))) {
      if (currentNetwork === 'mainnet-beta') {
        // Rotate only if enough time passed or immediately on 429
        const now = Date.now();
        if (now - lastRpcRotateTime > 5000 || error?.message?.includes('429')) {
           currentRpcIndex = (currentRpcIndex + 1) % RPC_ENDPOINTS.length;
           connection = null;
           lastRpcRotateTime = now;
           Logger.warn(`Switched RPC to ${RPC_ENDPOINTS[currentRpcIndex]}`);
        }
      }
      
      // Logger.warn(`RPC Error ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return withRetry(fn, retries - 1, delayMs * 2); // Exponential backoff
    }
    // Return empty/null if retries exhausted for some non-critical calls?
    // For now, let it throw so UI knows it failed.
    throw error;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fast confirmation helper to avoid long UI hangs on mobile RPC.
 * Treats processed/confirmed/finalized as accepted; still throws on explicit chain errors.
 */
async function waitForFastSignatureAcceptance(
  conn: Connection,
  signature: string,
  opts?: { timeoutMs?: number; pollMs?: number }
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 10000;
  const pollMs = opts?.pollMs ?? 700;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const statuses = await conn.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status?.err) {
      throw new Error('Transaction failed on chain');
    }
    if (
      status?.confirmationStatus === 'processed' ||
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return;
    }
    await sleep(pollMs);
  }

  // Final bounded confirm attempt.
  try {
    const confirmation = await Promise.race([
      conn.confirmTransaction(signature, 'confirmed'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('confirm timeout')), 4000)),
    ]);
    if (confirmation.value.err) {
      throw new Error('Transaction failed on chain');
    }
  } catch {
    // Do not block forever; caller can continue UX while network catches up.
  }
}

export async function getSolBalance(publicKeyStr: string): Promise<{ lamports: number; ui: string }> {
  return withRetry(async () => {
    const conn = getConnection();
    const pubKey = new PublicKey(publicKeyStr);
    const balance = await conn.getBalance(pubKey);
    return {
      lamports: balance,
      ui: (balance / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, ''),
    };
  });
}

export async function getSplTokenInfo(mintAddress: string): Promise<{ decimals: number; mint: string; symbol?: string }> {
  return withRetry(async () => {
    const conn = getConnection();
    const mint = new PublicKey(mintAddress);
    
    const info = await conn.getParsedAccountInfo(mint);
    
    if (!info.value) {
      throw new Error('Mint account not found');
    }

    const data = info.value.data;
    if (!('parsed' in data) || data.program !== 'spl-token' || data.parsed.type !== 'mint') {
      throw new Error('Invalid SPL token mint account');
    }

    return {
      decimals: data.parsed.info.decimals,
      mint: mintAddress,
    };
  });
}

export async function listNftMints(ownerPubkey: string): Promise<Array<{ mint: string; amountRaw: string }>> {
  return withRetry(async () => {
    const conn = getConnection();
    const owner = new PublicKey(ownerPubkey);

    try {
      const response = await conn.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_PROGRAM_ID,
      });

      return response.value
        .map((item) => {
          const data = item.account.data;
          if (!('parsed' in data)) return null;
          
          const info = data.parsed.info;
          if (!info || !info.tokenAmount) return null;

          const decimals = info.tokenAmount.decimals;
          const uiAmount = info.tokenAmount.uiAmount;
          
          if (decimals === 0 && uiAmount >= 1) {
            return {
              mint: info.mint,
              amountRaw: info.tokenAmount.amount,
            };
          }
          return null;
        })
        .filter((x): x is { mint: string; amountRaw: string } => x !== null);
    } catch (e: any) {
      console.error('Error listing NFTs:', e);
      return []; 
    }
  });
}

export async function getAssetsByOwner(
  ownerAddress: string
): Promise<{ items: Array<{ id: string; content?: any }> } | null> {
  try {
    const conn: any = getConnection() as any;
    const res = await withRetry<any>(() =>
      conn._rpcRequest('getAssetsByOwner', {
        ownerAddress,
        page: 1,
        limit: 100,
      })
    );
    const items = res?.result?.items;
    if (Array.isArray(items)) return { items };
    return null;
  } catch {
    return null;
  }
}

export async function getSplBalance(ownerAddress: string, mintAddress: string): Promise<string> {
  return withRetry(async () => {
    const conn = getConnection();
    const owner = new PublicKey(ownerAddress);
    const mint = new PublicKey(mintAddress);

    try {
      const response = await conn.getParsedTokenAccountsByOwner(owner, {
        mint: mint,
      });

      if (response.value.length === 0) return '0';

      let total = 0;
      for (const account of response.value) {
        const data = account.account.data;
        if ('parsed' in data) {
           total += data.parsed.info.tokenAmount.uiAmount || 0;
        }
      }
      return total.toString();
    } catch (e) {
      console.error('Error fetching SPL balance:', e);
      return '0';
    }
  });
}

const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

async function fetchNftUri(mint: PublicKey, conn: Connection): Promise<string | undefined> {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('metadata'),
        METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );

    const account = await conn.getAccountInfo(pda);
    if (!account) return undefined;

    // Parse Metadata (simplified)
    // 0: key (1)
    // 1: update_authority (32)
    // 33: mint (32)
    // 65: data
    //    name len (4) + name
    //    symbol len (4) + symbol
    //    uri len (4) + uri
    
    let offset = 1 + 32 + 32;
    
    // Name
    const nameLen = account.data.readUInt32LE(offset);
    offset += 4 + nameLen;
    
    // Symbol
    const symbolLen = account.data.readUInt32LE(offset);
    offset += 4 + symbolLen;
    
    // Uri
    const uriLen = account.data.readUInt32LE(offset);
    const uri = account.data.slice(offset + 4, offset + 4 + uriLen).toString('utf8').replace(/\0/g, '');
    
    return uri;
  } catch (e) {
    console.warn('Failed to fetch/parse metadata for mint', mint.toBase58(), e);
    return undefined;
  }
}

export async function getWalletPortfolio(ownerPublicKey: string, feeTokenMint: string): Promise<WalletPortfolio> {
  return withRetry(async () => {
  const conn = getConnection();
  const owner = new PublicKey(ownerPublicKey);

  // 1. Get SOL Balance
  const solBalance = await conn.getBalance(owner);
  const solUi = (solBalance / LAMPORTS_PER_SOL).toFixed(4);

  // 2. Get All Token Accounts
  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  const tokens: TokenBalance[] = [];
  const nfts: TokenBalance[] = [];

  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
  const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
  const BONK_MINT = 'HzwqbKZw8Nx5998E2BLR9g2498ZRuGWdC8jeW5B5bY1';
  const WIF_MINT = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';

  // Map to store found tokens to avoid duplicates or easy lookup
  const foundTokens = new Map<string, TokenBalance>();

  for (const { account } of tokenAccounts.value) {
    const parsedInfo = account.data.parsed.info;
    const mint = parsedInfo.mint;
    const amount = parsedInfo.tokenAmount.amount;
    const decimals = parsedInfo.tokenAmount.decimals;
    const uiAmount = parsedInfo.tokenAmount.uiAmount || 0;

    if (decimals === 0 && uiAmount >= 1) {
      nfts.push({
        symbol: 'NFT',
        mint,
        balance: uiAmount.toString(),
        decimals: 0
      });
      continue; // Don't add to regular tokens
    }

    // Check for specific tokens
    if (mint === USDC_MINT) {
      foundTokens.set('USDC', { symbol: 'USDC', mint, balance: uiAmount.toFixed(2), decimals });
    } else if (mint === USDT_MINT) {
      foundTokens.set('USDT', { symbol: 'USDT', mint, balance: uiAmount.toFixed(2), decimals });
    } else if (mint === JUP_MINT) {
      foundTokens.set('JUP', { symbol: 'JUP', mint, balance: uiAmount.toFixed(2), decimals });
    } else if (mint === BONK_MINT) {
      foundTokens.set('BONK', { symbol: 'BONK', mint, balance: uiAmount.toFixed(2), decimals });
    } else if (mint === WIF_MINT) {
      foundTokens.set('WIF', { symbol: 'WIF', mint, balance: uiAmount.toFixed(2), decimals });
    } else if (mint === feeTokenMint) {
      foundTokens.set('SEEKER', { symbol: 'SEEKER', mint, balance: uiAmount.toFixed(2), decimals });
    } else if (uiAmount > 0) {
      // Add other tokens too
      foundTokens.set(mint, { symbol: 'Unknown', mint, balance: uiAmount.toFixed(4), decimals });
    }
  }

  // Fetch Metadata for NFTs (in parallel but throttled)
  // Process in chunks of 5 to avoid 429
  const chunkSize = 5;
  for (let i = 0; i < nfts.length; i += chunkSize) {
    const chunk = nfts.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (nft) => {
      const uri = await fetchNftUri(new PublicKey(nft.mint), conn);
      if (uri) nft.uri = uri;
    }));
    if (i + chunkSize < nfts.length) await new Promise(r => setTimeout(r, 200)); // Small delay between chunks
  }

  if (nfts.length === 0) {
    try {
      const connAny = conn as any;
      const res = await connAny._rpcRequest('getAssetsByOwner', {
        ownerAddress: ownerPublicKey,
        page: 1,
        limit: 100,
      });

      const items = res?.result?.items;
      if (Array.isArray(items)) {
        for (const it of items) {
          const id = it?.id;
          const jsonUri = it?.content?.json_uri;
          const imageUri = it?.content?.links?.image || it?.content?.files?.[0]?.uri;
          const uri = jsonUri || imageUri;
          if (typeof id === 'string' && typeof uri === 'string') {
            nfts.push({ symbol: 'NFT', mint: id, balance: '1', decimals: 0, uri });
          }
        }
      }
    } catch {}
  }

  // Ensure priority tokens exist in the list even if 0
  const resultTokens: TokenBalance[] = [];
  
  resultTokens.push(foundTokens.get('USDC') || { symbol: 'USDC', mint: USDC_MINT, balance: '0', decimals: 6 });
  resultTokens.push(foundTokens.get('USDT') || { symbol: 'USDT', mint: USDT_MINT, balance: '0', decimals: 6 });
  resultTokens.push(foundTokens.get('SEEKER') || { symbol: 'SEEKER', mint: feeTokenMint, balance: '0', decimals: 9 });
  
  // Add other tokens
  foundTokens.forEach((val, key) => {
    if (key !== 'USDC' && key !== 'USDT' && key !== 'SEEKER') {
        resultTokens.push(val);
    }
  });

  return {
    sol: solUi,
    tokens: resultTokens,
    nfts,
  };
  });
}

export async function getAllTokens(ownerPublicKey: string, knownMints: Record<string, string> = {}): Promise<TokenBalance[]> {
  const conn = getConnection();
  const owner = new PublicKey(ownerPublicKey);

  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  const tokens: TokenBalance[] = [];
  
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

  for (const { account } of tokenAccounts.value) {
    const parsedInfo = account.data.parsed.info;
    const mint = parsedInfo.mint;
    const decimals = parsedInfo.tokenAmount.decimals;
    const uiAmountString = parsedInfo.tokenAmount.uiAmountString || '0';
    const uiAmount = parsedInfo.tokenAmount.uiAmount || 0;

    if (uiAmount > 0) {
        let symbol = 'Unknown';
        if (mint === USDC_MINT) symbol = 'USDC';
        else if (mint === USDT_MINT) symbol = 'USDT';
        else if (knownMints[mint]) symbol = knownMints[mint];
        
        tokens.push({
            symbol,
            mint,
            balance: uiAmountString,
            decimals
        });
    }
  }
  return tokens;
}

// --- Fee Payment Logic ---

async function findAssociatedTokenAddress(
    walletAddress: PublicKey,
    tokenMintAddress: PublicKey
): Promise<PublicKey> {
    return (await PublicKey.findProgramAddress(
        [
            walletAddress.toBuffer(),
            TOKEN_PROGRAM_ID.toBuffer(),
            tokenMintAddress.toBuffer(),
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
    ))[0];
}

function createAssociatedTokenAccountInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedToken, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    keys,
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([]),
  });
}

function createTransferInstruction(
  source: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint
): TransactionInstruction {
  const keys = [
    { pubkey: source, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false },
  ];
  
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0); // Instruction 3 = Transfer
  // Write BigInt as 64-bit LE
  const bigIntBuffer = Buffer.alloc(8);
  bigIntBuffer.writeBigUInt64LE(amount);
  bigIntBuffer.copy(data, 1);

  return new TransactionInstruction({
    keys,
    programId: TOKEN_PROGRAM_ID,
    data,
  });
}

export async function payFeeInSplToken({
  ownerPubkey,
  payerSignerMode,
  feeMint,
  feeAmountUi,
  treasuryAddress,
}: {
  ownerPubkey: string;
  payerSignerMode: 'adapter' | 'built_in';
  feeMint: string;
  feeAmountUi: string;
  treasuryAddress: string;
}): Promise<string> {
  const conn = getConnection();
  const owner = new PublicKey(ownerPubkey);
  const mint = new PublicKey(feeMint);
  const treasury = new PublicKey(treasuryAddress);

  // 1. Get Decimals to convert UI amount
  const mintInfo = await getSplTokenInfo(feeMint);
  const amountRaw = BigInt(Math.round(parseFloat(feeAmountUi) * Math.pow(10, mintInfo.decimals)));

  if (amountRaw === BigInt(0)) {
     throw new Error('Fee amount is 0');
  }

  // 2. Find ATAs
  const ownerAta = await findAssociatedTokenAddress(owner, mint);
  const treasuryAta = await findAssociatedTokenAddress(treasury, mint);

  const transaction = new Transaction();

  // 3. Check if treasury ATA exists, if not create it
  // (Ideally the payer pays for this rent. If built-in, owner pays.)
  const treasuryAccount = await conn.getAccountInfo(treasuryAta);
  if (!treasuryAccount) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        owner, // payer
        treasuryAta,
        treasury, // owner of new ATA
        mint
      )
    );
  }

  // 4. Check owner balance
  // We can trust getSplBalance or check strictly here.
  // Assuming caller checked UI balance. But let's be safe.
  // For now, let the transaction fail if insufficient funds (simulation).

  // 5. Add Transfer instruction
  transaction.add(
    createTransferInstruction(ownerAta, treasuryAta, owner, amountRaw)
  );

  const { blockhash } = await conn.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = owner;

  // 6. Sign and Send
  if (payerSignerMode === 'built_in') {
    await signTransaction(transaction);
    const rawTx = transaction.serialize();
    return await conn.sendRawTransaction(rawTx);
  } else {
    // Adapter mode - stub for now
    // In real implementation, we would call window.solana.signAndSendTransaction or use wallet-adapter
    console.warn('Adapter signing not implemented yet');
    // Simulate success for UI flow if in dev? No, throw error.
    throw new Error('Wallet adapter signing not connected yet. Use built-in wallet.');
  }
}

export async function sendBuiltBatches({
  batches,
  walletMode,
  ownerPubkey,
}: {
  batches: BuiltBatch[];
  walletMode: 'adapter' | 'built_in';
  ownerPubkey?: string;
}): Promise<string[]> {
  if (walletMode === 'adapter') {
    throw new Error('Adapter signing not wired yet. Use built-in wallet for now.');
  }

  const conn = getConnection();
  const owner = ownerPubkey ? new PublicKey(ownerPubkey) : null;
  const sigs: string[] = [];

  for (const batch of batches) {
    const tx = batch.tx;
    const feePayer = owner ?? tx.feePayer ?? null;
    if (!feePayer) {
      throw new Error('Missing fee payer for transaction');
    }

    const latest = await conn.getLatestBlockhash();
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = feePayer;

    await signTransaction(tx);
    const raw = tx.serialize();
    const signature = await conn.sendRawTransaction(raw);
    await waitForFastSignatureAcceptance(conn, signature);
    sigs.push(signature);
  }

  return sigs;
}

export async function sendSol({
  to,
  amountUi,
  from,
  walletMode
}: {
  to: string;
  amountUi: string;
  from: string;
  walletMode: 'adapter' | 'built_in';
}): Promise<string> {
  const conn = getConnection();
  const transaction = new Transaction();
  const recipient = new PublicKey(to);
  const sender = new PublicKey(from);
  const lamports = Math.round(parseFloat(amountUi) * LAMPORTS_PER_SOL);

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: sender,
      toPubkey: recipient,
      lamports,
    })
  );

  const { blockhash } = await conn.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = sender;

  if (walletMode === 'built_in') {
    await signTransaction(transaction);
    const rawTx = transaction.serialize();
    const sig = await conn.sendRawTransaction(rawTx);
    await waitForFastSignatureAcceptance(conn, sig);
    return sig;
  } else {
    throw new Error('Adapter mode not supported for manual send yet');
  }
}

export async function sendSplToken({
  to,
  mint,
  amountUi,
  decimals,
  from,
  walletMode
}: {
  to: string;
  mint: string;
  amountUi: string;
  decimals: number;
  from: string;
  walletMode: 'adapter' | 'built_in';
}): Promise<string> {
  const conn = getConnection();
  const transaction = new Transaction();
  const recipient = new PublicKey(to);
  const sender = new PublicKey(from);
  const mintKey = new PublicKey(mint);
  
  // Calculate raw amount
  const amountRaw = BigInt(Math.round(parseFloat(amountUi) * Math.pow(10, decimals)));

  // Get ATAs
  const senderAta = await findAssociatedTokenAddress(sender, mintKey);
  const recipientAta = await findAssociatedTokenAddress(recipient, mintKey);

  // Check if recipient ATA exists, if not create it
  const recipientAccount = await conn.getAccountInfo(recipientAta);
  if (!recipientAccount) {
    transaction.add(
      createAssociatedTokenAccountInstruction(
        sender, // payer
        recipientAta,
        recipient, // owner
        mintKey
      )
    );
  }

  // Transfer
  transaction.add(
    createTransferInstruction(senderAta, recipientAta, sender, amountRaw)
  );

  const { blockhash } = await conn.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = sender;

  if (walletMode === 'built_in') {
    await signTransaction(transaction);
    const rawTx = transaction.serialize();
    const sig = await conn.sendRawTransaction(rawTx);
    await waitForFastSignatureAcceptance(conn, sig);
    return sig;
  } else {
    throw new Error('Adapter mode not supported for manual send yet');
  }
}
