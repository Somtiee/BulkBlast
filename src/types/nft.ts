import { PublicKey } from '@solana/web3.js';

export type NftStandard = 
  | 'standard_spl_nft' 
  | 'semi_fungible' 
  | 'programmable_nft' 
  | 'compressed_nft' 
  | 'token2022_asset' 
  | 'unknown';

export type DetectedNftItem = {
  mint: string;
  name: string;
  uri: string;
  standard: NftStandard;
};

export type DetectedNftAsset = { 
  groupId: string; 
  groupName: string; 
  items: DetectedNftItem[]; 
  ownedCount: number; 
  
  // Representative metadata for the group (e.g. collection image)
  imageUri?: string;
  
  // Detected standard for the group (usually matches items, but can be mixed)
  standard: NftStandard;
  tokenProgram?: string; // Optional program ID
}; 

export type NftTransferBatch = {
  standard: NftStandard;
  mints: string[];
  recipients: { address: string; amount: number }[]; // Usually 1 per recipient for NFTs
};
