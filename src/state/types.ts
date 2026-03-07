import type { Recipient } from '../types/recipient';
import type { AssetBalance, SelectedAsset } from '../types/asset';

export type WalletMode = 'adapter' | 'built_in' | null;

export type BuiltInWalletStatus = 'locked' | 'unlocked' | 'none';

export type SwapConfig = {
  enabled: true;
  provider: 'jupiter_like_stub';
};

export type FeeQuote = {
  recipientCount: number;
  feeUsd: string;
  discountedFeeUsd: string;
  feeTokens: string;
  rateUsdPerToken: string;
};

export type SendConfig = {
  batchSize: number;
  createRecipientAtaIfMissing: boolean;
  maxTotalSolUi: string;
  maxRecipients: number;
  requireDoubleConfirm: boolean;
  amountMode: 'equal' | 'perRecipient';
  equalAmountUi: string;
  equalNftCount: number;
};

export type GiveawayConfig = {
  enabled: boolean;
  winnerCount: number;
  selectedRecipientIds: string[];
};

export type AppState = {
  walletMode: WalletMode;
  walletPublicKey: string | null;
  builtInWalletStatus: BuiltInWalletStatus;
  feeTokenMint: string;
  treasuryAddress: string;
  seekerDiscountEnabled: boolean;
  solanaMobileOwner: boolean;
  network: 'devnet' | 'mainnet-beta'; // Added network to state
  sendConfig: SendConfig;
  giveawayConfig: GiveawayConfig;
  swapConfig: SwapConfig;
  recipients: Recipient[];
  selectedAsset: SelectedAsset | null;
  assetBalance: AssetBalance | null;
  feeQuote: FeeQuote | null;
};

export type AppAction =
  | { type: 'wallet/connectedAdapter'; publicKey: string }
  | { type: 'wallet/createdBuiltIn'; publicKey: string }
  | { type: 'wallet/importedBuiltIn'; publicKey: string }
  | { type: 'wallet/unlockedBuiltIn'; publicKey: string }
  | { type: 'wallet/lockedBuiltIn' }
  | { type: 'wallet/reset' }
  | { type: 'settings/setTreasuryAddress'; treasuryAddress: string }
  | { type: 'settings/toggleSeekerDiscount' }
  | { type: 'settings/setSolanaMobileOwner'; value: boolean }
  | { type: 'settings/setNetwork'; network: 'devnet' | 'mainnet-beta' } // Added action
  | { type: 'sendConfig/setBatchSize'; batchSize: number }
  | { type: 'sendConfig/setAmountMode'; mode: 'equal' | 'perRecipient' }
  | { type: 'sendConfig/setEqualAmount'; amountUi: string }
  | { type: 'sendConfig/setEqualNftCount'; count: number }
  | { type: 'sendConfig/toggleCreateAta' }
  | { type: 'giveaway/enable' }
  | { type: 'giveaway/disable' }
  | { type: 'giveaway/setWinnerCount'; count: number }
  | { type: 'giveaway/setSelectedRecipients'; ids: string[] }
  | { type: 'recipients/setAll'; recipients: Recipient[] }
  | { type: 'recipients/clear' }
  | { type: 'recipients/removeByIds'; ids: string[] }
  | { type: 'recipients/update'; id: string; address: string; amount?: string }
  | { type: 'recipients/cleanInvalid' }
  | { type: 'recipients/cleanDuplicates' }
  | { type: 'asset/setSelected'; asset: SelectedAsset }
  | { type: 'asset/setBalance'; balance: AssetBalance }
  | { type: 'asset/clear' }
  | { type: 'fee/setQuote'; quote: FeeQuote }
  | { type: 'fee/clear' };
