export type Recipient = {
  id: string;
  address: string;
  amount?: string;
  source: 'manual' | 'csv' | 'qr';
  isValid: boolean;
  error?: 'invalid_address' | 'duplicate';
};

