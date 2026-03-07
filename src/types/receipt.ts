import type { SelectedAsset } from './asset';

export type BatchReceipt = {
  batchIndex: number;
  ok: boolean;
  signature?: string;
  error?: string;
  startedAt: number;
  finishedAt: number;
  recipientIds?: string[];
};

export type DropReceipt = {
  id: string;
  createdAt: number;
  network: 'mainnet-beta' | 'devnet';
  walletPublicKey: string;
  asset: SelectedAsset;
  recipientCount: number;
  validRecipientCount: number;
  totalAmountUi: string;
  recipients?: Array<{ id: string; address: string; amount?: string }>;
  fee: {
    feeMint: string;
    feeTokens: string;
    discounted: boolean;
  };
  batchSize: number;
  batches: BatchReceipt[];
  status: 'pending' | 'partial' | 'success' | 'failed';
};
