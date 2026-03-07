import { DetectedNftItem, NftStandard } from './nft';

export type SelectedAsset =
  | { kind: 'SOL'; mint: string; symbol: string; decimals: number }
  | { kind: 'SPL'; mint: string; symbol?: string; decimals: number }
  | { 
      kind: 'NFT'; 
      mint: string; // Used as Group ID
      symbol?: string; // Used as Group Name
      decimals: 0; 
      groupItems?: DetectedNftItem[]; // Array of actual NFT items in the group
      ownedCount?: number;
      standard?: NftStandard;
      tokenProgram?: string;
    };

export type AssetBalance = {
  amountUi: string;
  raw: string;
};
