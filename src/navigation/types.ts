export type AuthStackParamList = {
  Welcome: undefined;
  WalletSetup: undefined;
  CreateOrImportWallet: undefined;
  ImportPrivateKey: undefined;
};

export type CreateDropStackParamList = {
  CreateDrop: undefined;
  AssetSelect: undefined;
  ScanRecipients: undefined;
  Review: undefined;
  ExecuteProgress: { jobId?: string; confirmed: boolean; failedRecipientIds?: string[] } | undefined;
  SwapModal: undefined;
  ReceiptDetails: { id: string };
};

export type MainTabsParamList = {
  CreateDropStack: undefined;
  History: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};
