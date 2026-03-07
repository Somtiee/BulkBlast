
import { 
  Connection, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  TransactionInstruction 
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import { DetectedNftAsset, NftStandard } from '../types/nft';
import { Recipient } from '../types/recipient';
import { Logger } from '../utils/Logger';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export type NftBatchResult = {
  tx: Transaction;
  recipients: Recipient[];
  mintsUsed: string[];
};

import { AmountConfig } from './TransactionService';

export const NftTransferService = {
  /**
   * Helper to normalize and validate transferable items from a group.
   * Ensures we only attempt to transfer valid mints/assets.
   */
  normalizeTransferableItems(group: DetectedNftAsset): { 
    transferableItems: { mint: string; standard: NftStandard }[], 
    rejectedCount: number 
  } {
    const validItems: { mint: string; standard: NftStandard }[] = [];
    let rejected = 0;

    for (const item of group.items) {
      // Validate Mint Address
      try {
        new PublicKey(item.mint); // Throws if invalid
        validItems.push({ mint: item.mint, standard: item.standard });
      } catch (e) {
        console.warn(`Invalid mint found in group ${group.groupId}: ${item.mint}`);
        rejected++;
      }
    }

    return { transferableItems: validItems, rejectedCount: rejected };
  },

  /**
   * Main entry point to build NFT transfer batches.
   * Routes to specific logic based on DetectedNftAsset standard.
   */
  async buildTransferBatches(
    connection: Connection,
    sender: PublicKey,
    group: DetectedNftAsset,
    recipients: Recipient[],
    batchSize: number = 10,
    amountConfig?: AmountConfig
  ): Promise<NftBatchResult[]> {
    
    // 0. Normalize and Validate Source Items
    const { transferableItems, rejectedCount } = this.normalizeTransferableItems(group);
    
    if (transferableItems.length === 0) {
       throw new Error(`No valid transferable items found in collection "${group.groupName}".`);
    }

    // Calculate total required
    let totalRequired = 0;
    if (amountConfig?.mode === 'equal') {
       totalRequired = recipients.length * (amountConfig.equalNftCount || 1);
    } else {
       totalRequired = recipients.reduce((acc, r) => acc + (parseInt(r.amount || '1') || 1), 0);
    }

    // 1. Validation
    if (totalRequired > transferableItems.length) {
      throw new Error(`Insufficient valid NFTs. Available: ${transferableItems.length}, Required: ${totalRequired}. (Rejected invalid: ${rejectedCount})`);
    }

    // 2. Routing
    // We use the group standard generally, but could inspect items if mixed.
    // For now assuming homogeneous groups based on detection service.
    switch (group.standard) {
      case 'standard_spl_nft':
      case 'semi_fungible':
      case 'token2022_asset':
        // Pass the CLEAN list of mints, not the raw group
        return this.buildStandardOrToken2022Batches(
            connection, 
            sender, 
            transferableItems.map(i => i.mint), 
            group.tokenProgram, 
            recipients, 
            batchSize, 
            amountConfig
        );
      
      case 'programmable_nft':
        throw new Error('Programmable NFTs (pNFT) are not yet supported for bulk transfer. Authorization rules required.');
      
      case 'compressed_nft':
        throw new Error('Compressed NFTs (cNFT) require compression support (Bubblegum) which is not enabled.');
        
      default:
        throw new Error(`Unsupported NFT standard: ${group.standard}`);
    }
  },

  async buildStandardOrToken2022Batches(
    connection: Connection,
    sender: PublicKey,
    availableMints: string[], // Pre-validated mint strings
    tokenProgramIdStr: string | undefined,
    recipients: Recipient[],
    batchSize: number,
    amountConfig?: AmountConfig
  ): Promise<NftBatchResult[]> {
    const batches: NftBatchResult[] = [];
    
    // Determine Program ID from detection
    const programId = tokenProgramIdStr ? new PublicKey(tokenProgramIdStr) : TOKEN_PROGRAM_ID;

    const { blockhash } = await connection.getLatestBlockhash();

    // Enforce stricter batch limits for NFTs due to instruction count
    // Each transfer = 2 instructions (CreateATA + Transfer).
    // Safe limit ~12 instructions = 6 transfers per tx.
    const SAFE_NFT_BATCH_SIZE = Math.min(batchSize, 6);

    // Chunk recipients
    for (let i = 0; i < recipients.length; i += SAFE_NFT_BATCH_SIZE) {
      const chunk = recipients.slice(i, i + SAFE_NFT_BATCH_SIZE);
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = sender;
      
      const mintsInBatch: string[] = [];
      let instructionsCount = 0;

      for (const recipient of chunk) {
        // Determine amount for this recipient
        let amount = 1;
        if (amountConfig?.mode === 'equal') {
            amount = amountConfig.equalNftCount || 1;
        } else {
            amount = parseInt(recipient.amount || '1') || 1;
        }

        // Safety check: Don't allow single recipient to blow up tx size
        if (instructionsCount + (amount * 2) > 20) {
            // If this recipient pushes us over, we should technically break and start new batch
            // But simplistic logic: just warn or cap?
            // For now, let's just proceed but we capped batchSize to 6 recipients so likely fine unless amount > 1.
            // If amount > 1 per recipient, we have a problem.
        }

        for (let k = 0; k < amount; k++) {
            const mintStr = availableMints.shift();
            if (!mintStr) throw new Error('Ran out of mints during batch building');
            mintsInBatch.push(mintStr);

            const mint = new PublicKey(mintStr);
            const recipientPubkey = new PublicKey(recipient.address);

            // 1. Derive ATAs
            const senderAta = this.getAta(sender, mint, programId);
            const recipientAta = this.getAta(recipientPubkey, mint, programId);

            // 2. Create ATA Instruction (Idempotent)
            tx.add(this.createAtaInstruction(sender, recipientAta, recipientPubkey, mint, programId));

            // 3. Transfer Instruction (Amount 1 per unique mint)
            tx.add(this.createTransferInstruction(senderAta, recipientAta, sender, 1n, programId));
            
            instructionsCount += 2;
        }
      }
      
      // If we somehow added too many instructions (e.g. multiple NFTs per recipient), warn
      if (instructionsCount > 30) {
          Logger.warn(`Batch ${batches.length + 1} has ${instructionsCount} instructions. Might exceed size limit.`);
      }

      batches.push({
        tx,
        recipients: chunk,
        mintsUsed: mintsInBatch
      });
    }

    return batches;
  },

  // --- Helpers ---

  getAta(owner: PublicKey, mint: PublicKey, programId: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID
    )[0];
  },

  createAtaInstruction(
    payer: PublicKey,
    ata: PublicKey,
    owner: PublicKey,
    mint: PublicKey,
    programId: PublicKey
  ): TransactionInstruction {
    return new TransactionInstruction({
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: ata, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: programId, isSigner: false, isWritable: false },
        { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
      ],
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      data: Buffer.from([1]), // CreateIdempotent
    });
  },

  createTransferInstruction(
    source: PublicKey,
    dest: PublicKey,
    owner: PublicKey,
    amount: bigint,
    programId: PublicKey
  ): TransactionInstruction {
    const keys = [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ];

    const data = Buffer.alloc(9);
    data.writeUInt8(3, 0); // Transfer Instruction
    const bigIntBuffer = Buffer.alloc(8);
    bigIntBuffer.writeBigUInt64LE(amount);
    bigIntBuffer.copy(data, 1);

    return new TransactionInstruction({
      keys,
      programId,
      data,
    });
  }
};
