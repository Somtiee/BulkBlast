export type AuthStackParamList = {
  Welcome: undefined;
  WalletSetup: undefined;
  CreateOrImportWallet: undefined;
  ImportPrivateKey: undefined;
};

/** Bulk Send (CreateDrop) optional pre-fill from Bags launch or deep links. */
export type CreateDropScreenParams = {
  preFilledMint?: string;
  preFilledSymbol?: string;
  /** Default true when mint is passed from Launch & Blast */
  bagsBlastBanner?: boolean;
  /** One-time promo: waive fee when coming from Launch success "BLAST NOW". */
  launchBlastFreeFee?: boolean;
};

export type CreateDropStackParamList = {
  CreateDrop: CreateDropScreenParams | undefined;
  AssetSelect: undefined;
  ScanRecipients: undefined;
  Review: undefined;
  ExecuteProgress:
    | {
        jobId?: string;
        confirmed: boolean;
        failedRecipientIds?: string[];
        feeTokenMint?: string;
        feeTokenSymbol?: 'SKR' | 'SOL';
        feeAmountUi?: string;
      }
    | undefined;
  SwapModal: undefined;
  ReceiptDetails: { id: string };
  LaunchBlast: undefined;
  LaunchBlastSuccess: {
    tokenMint: string;
    tokenSymbol: string;
    /** Confirmed launch transaction signature */
    signature: string;
  };
  LaunchBlastHistory: undefined;
};

export type MainTabsParamList = {
  CreateDropStack: undefined;
  LaunchStack: undefined;
  History: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};
