import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { Recipient } from '../types/recipient';
import { Buffer } from 'buffer';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export type BuiltBatch = {
  index: number;
  tx: Transaction;
  recipients: Recipient[];
  kind: 'SOL' | 'SPL' | 'NFT';
};

export type BuildResult = {
  batches: BuiltBatch[];
  summary: { totalRecipients: number; totalAmountUi: string };
};

export type AmountConfig = {
  mode: 'equal' | 'perRecipient';
  equalAmountUi: string;
  equalNftCount: number;
};

function splitIntoBatches<T>(items: T[], batchSize: number): T[][] {
  const size = Math.max(1, Math.min(20, Math.floor(batchSize)));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function safeParsePositiveUiAmount(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  if (n > 1_000_000) return null;
  return n;
}

function uiToLamportsNumber(ui: number): number | null {
  const lamports = Math.round(ui * LAMPORTS_PER_SOL);
  if (!Number.isFinite(lamports) || lamports <= 0) return null;
  if (lamports > Number.MAX_SAFE_INTEGER) return null;
  return lamports;
}

function uiToRawTokenAmount(ui: number, decimals: number): bigint {
  const raw = Math.round(ui * Math.pow(10, decimals));
  if (!Number.isFinite(raw) || raw <= 0) return BigInt(0);
  return BigInt(raw);
}

function formatUiAmount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  return value.toFixed(9).replace(/\.?0+$/, '');
}

function findAssociatedTokenAddress(walletAddress: PublicKey, tokenMintAddress: PublicKey, tokenProgramId: PublicKey = TOKEN_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [walletAddress.toBuffer(), tokenProgramId.toBuffer(), tokenMintAddress.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function createAssociatedTokenAccountInstruction({
  payer,
  associatedToken,
  owner,
  mint,
  tokenProgramId = TOKEN_PROGRAM_ID,
}: {
  payer: PublicKey;
  associatedToken: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  tokenProgramId?: PublicKey;
}): TransactionInstruction {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedToken, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    keys,
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([1]), // 1 = CreateIdempotent
  });
}

function createTransferInstruction({
  source,
  destination,
  owner,
  amount,
  tokenProgramId = TOKEN_PROGRAM_ID,
}: {
  source: PublicKey;
  destination: PublicKey;
  owner: PublicKey;
  amount: bigint;
  tokenProgramId?: PublicKey;
}): TransactionInstruction {
  const keys = [
    { pubkey: source, isSigner: false, isWritable: true },
    { pubkey: destination, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: true, isWritable: false },
  ];

  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  const bigIntBuffer = Buffer.alloc(8);
  bigIntBuffer.writeBigUInt64LE(amount);
  bigIntBuffer.copy(data, 1);

  return new TransactionInstruction({
    keys,
    programId: tokenProgramId,
    data,
  });
}

export async function buildSolBatches(
  connection: Connection,
  senderPublicKey: PublicKey,
  recipients: Recipient[],
  batchSize: number,
  amountConfig: AmountConfig
): Promise<BuildResult> {
  const validRecipients = recipients.filter((r) => r.isValid);
  if (validRecipients.length === 0) {
    throw new Error('No valid recipients provided');
  }

  const batches = splitIntoBatches(validRecipients, batchSize);
  const builtBatches: BuiltBatch[] = [];
  let totalAmountUi = 0;

  const { blockhash } = await connection.getLatestBlockhash();

  for (let i = 0; i < batches.length; i++) {
    const batchRecipients = batches[i];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = senderPublicKey;

    for (const r of batchRecipients) {
      const recipientPubkey = new PublicKey(r.address);
      let amount: number;

      if (amountConfig.mode === 'equal') {
        amount = Number(amountConfig.equalAmountUi);
      } else {
        amount = Number(r.amount);
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`Invalid amount for recipient ${r.address}: ${amount}`);
      }
      
      const lamports = Math.round(amount * LAMPORTS_PER_SOL);
      totalAmountUi += amount;

      tx.add(
        SystemProgram.transfer({
          fromPubkey: senderPublicKey,
          toPubkey: recipientPubkey,
          lamports,
        })
      );
    }

    builtBatches.push({
      index: i,
      tx,
      recipients: batchRecipients.map(r => ({
        ...r,
        amount: amountConfig.mode === 'equal' ? amountConfig.equalAmountUi : r.amount
      })),
      kind: 'SOL',
    });
  }

  return {
    batches: builtBatches,
    summary: {
      totalRecipients: validRecipients.length,
      totalAmountUi: totalAmountUi.toFixed(9),
    },
  };
}

export async function buildSplBatches(
  connection: Connection,
  senderPublicKey: PublicKey,
  recipients: Recipient[],
  mintAddress: PublicKey,
  decimals: number,
  batchSize: number,
  amountConfig: AmountConfig,
  createAta: boolean
): Promise<BuildResult> {
  const validRecipients = recipients.filter((r) => r.isValid);
  if (validRecipients.length === 0) {
    throw new Error('No valid recipients provided');
  }

  const senderAta = findAssociatedTokenAddress(senderPublicKey, mintAddress);
  const batches = splitIntoBatches(validRecipients, batchSize);
  const builtBatches: BuiltBatch[] = [];
  let totalAmountUi = 0;

  const { blockhash } = await connection.getLatestBlockhash();

  for (let i = 0; i < batches.length; i++) {
    const batchRecipients = batches[i];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = senderPublicKey;

    for (const r of batchRecipients) {
      const recipientPubkey = new PublicKey(r.address);
      const recipientAta = findAssociatedTokenAddress(recipientPubkey, mintAddress);

      if (createAta) {
        // Idempotent: create ATA if missing
        tx.add(
          createAssociatedTokenAccountInstruction({
            payer: senderPublicKey,
            associatedToken: recipientAta,
            owner: recipientPubkey,
            mint: mintAddress,
          })
        );
      }

      let amount: number;
      if (amountConfig.mode === 'equal') {
        if (decimals === 0) {
           amount = amountConfig.equalNftCount;
        } else {
           amount = Number(amountConfig.equalAmountUi);
        }
      } else {
        amount = Number(r.amount);
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`Invalid amount for recipient ${r.address}: ${amount}`);
      }

      totalAmountUi += amount;
      const rawAmount = uiToRawTokenAmount(amount, decimals);

      tx.add(
        createTransferInstruction({
          source: senderAta,
          destination: recipientAta,
          owner: senderPublicKey,
          amount: rawAmount,
        })
      );
    }

    builtBatches.push({
      index: i,
      tx,
      recipients: batchRecipients.map(r => ({
        ...r,
        amount: amountConfig.mode === 'equal' 
          ? (decimals === 0 ? amountConfig.equalNftCount.toString() : amountConfig.equalAmountUi)
          : r.amount
      })),
      kind: 'SPL',
    });
  }

  return {
    batches: builtBatches,
    summary: {
      totalRecipients: validRecipients.length,
      totalAmountUi: totalAmountUi.toFixed(decimals),
    },
  };
}

export type BuildNftResult = {
  batches: BuiltBatch[];
  summary: { totalRecipients: number; totalNfts: number };
};

export async function buildNftBatches(
  connection: Connection,
  senderPublicKey: PublicKey,
  recipients: Recipient[],
  groupItems: { mint: string }[],
  batchSize: number,
  createAta: boolean,
  amountConfig: AmountConfig
): Promise<BuildNftResult> {
  const validRecipients = recipients.filter((r) => r.isValid);
  if (validRecipients.length === 0) {
    throw new Error('No valid recipients provided');
  }

  const batches: BuiltBatch[] = [];
  let availableNfts = [...groupItems];
  let totalNftsUsed = 0;

  const { blockhash } = await connection.getLatestBlockhash();

  // Pre-fetch mint account info to determine Token Program ID
  // Optimisation: Do this in chunks if many NFTs, but usually < 50
  // For now, we assume simple batching.
  // We need to know if mint is Token-2022 or Token.
  // We can fetch multiple accounts at once.
  
  // Actually, let's fetch in the loop or pre-fetch all?
  // Pre-fetch is better.
  const mintPubkeys = availableNfts.map(n => new PublicKey(n.mint));
  const mintInfos = await connection.getMultipleAccountsInfo(mintPubkeys);
  
  const mintProgramIds = new Map<string, PublicKey>();
  mintInfos.forEach((info, i) => {
    if (info) {
      mintProgramIds.set(availableNfts[i].mint, info.owner);
    }
  });

  const recipientBatches = splitIntoBatches(validRecipients, batchSize);

  for (let i = 0; i < recipientBatches.length; i++) {
    const batchRecipients = recipientBatches[i];
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = senderPublicKey;

    for (const r of batchRecipients) {
       let count: number;
       if (amountConfig.mode === 'equal') {
          count = amountConfig.equalNftCount;
       } else {
          const val = parseInt(r.amount || '0', 10);
          if (isNaN(val) || val <= 0) {
             throw new Error(`Invalid NFT amount for ${r.address}: ${r.amount}`);
          }
          count = val;
       }

       if (availableNfts.length < count) {
         throw new Error(`Not enough NFTs in collection. Need ${count} for ${r.address}, but only ${availableNfts.length} left.`);
       }

       const nftsToSend = availableNfts.splice(0, count);
       totalNftsUsed += count;

       for (const nft of nftsToSend) {
          const mintAddress = new PublicKey(nft.mint);
          const recipientPubkey = new PublicKey(r.address);
          
          // Resolve Program ID
          // Default to TOKEN_PROGRAM_ID if unknown (fallback), but we should have it.
          const programId = mintProgramIds.get(nft.mint) || TOKEN_PROGRAM_ID;

          const senderAta = findAssociatedTokenAddress(senderPublicKey, mintAddress, programId);
          const recipientAta = findAssociatedTokenAddress(recipientPubkey, mintAddress, programId);

          if (createAta) {
            tx.add(
              createAssociatedTokenAccountInstruction({
                payer: senderPublicKey,
                associatedToken: recipientAta,
                owner: recipientPubkey,
                mint: mintAddress,
                tokenProgramId: programId,
              })
            );
          }

          tx.add(
            createTransferInstruction({
              source: senderAta,
              destination: recipientAta,
              owner: senderPublicKey,
              amount: 1n,
              tokenProgramId: programId,
            })
          );
       }
    }
    
    batches.push({
      index: i,
      tx,
      recipients: batchRecipients,
      kind: 'NFT',
    });
  }

  return {
    batches,
    summary: {
      totalRecipients: validRecipients.length,
      totalNfts: totalNftsUsed,
    },
  };
}
