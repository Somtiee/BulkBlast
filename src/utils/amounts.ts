import { PublicKey } from '@solana/web3.js';
import type { Recipient } from '../types/recipient';
import type { SelectedAsset } from '../types/asset';

export function validateAmount(amount: string, isNft: boolean = false): boolean {
  if (!amount) return false;
  const num = Number(amount);
  if (isNaN(num) || num <= 0) return false;
  if (isNft && !Number.isInteger(num)) return false;
  return true;
}

export function computeTotalToSend(
  recipients: Recipient[],
  mode: 'equal' | 'perRecipient',
  equalAmount: string,
  equalNftCount: number,
  asset: SelectedAsset | null
): string {
  if (!asset) return '0';
  const isNft = asset.kind === 'SPL' && asset.decimals === 0; // Heuristic for NFT/Semi-fungible often used here, or check mint logic? 
  // Actually BulkBlast treats NFT asset selection differently (e.g. standard SPL with 0 decimals is effectively an NFT edition/token)
  // But let's stick to the prompt: NFT amounts must be whole numbers.
  
  // If we are in "NFT Mode" (meaning asset is NFT-like), we enforce integer.
  // Ideally asset should have a flag or we check decimals === 0.
  const enforceInteger = asset.kind === 'SPL' && asset.decimals === 0;

  if (mode === 'equal') {
    const validCount = recipients.filter(r => r.isValid).length;
    if (enforceInteger) {
       return (validCount * Math.floor(equalNftCount)).toString();
    }
    const per = parseFloat(equalAmount) || 0;
    return (validCount * per).toString(); // formatting needed later?
  }

  // Per recipient
  let total = 0;
  for (const r of recipients) {
    if (!r.isValid) continue;
    const amt = parseFloat(r.amount || '0');
    if (!isNaN(amt) && amt > 0) {
      if (enforceInteger) {
        total += Math.floor(amt);
      } else {
        total += amt;
      }
    }
  }
  return total.toString();
}

export function validateRecipientsAmounts(
  recipients: Recipient[],
  mode: 'equal' | 'perRecipient',
  equalAmount: string,
  isNft: boolean
): { valid: boolean; missingCount: number; invalidCount: number } {
  if (mode === 'equal') {
    if (isNft) return { valid: true, missingCount: 0, invalidCount: 0 }; // Stepper always valid?
    return { valid: validateAmount(equalAmount, false), missingCount: 0, invalidCount: 0 };
  }

  let missing = 0;
  let invalid = 0;
  for (const r of recipients) {
    if (!r.isValid) continue;
    if (!r.amount) {
      missing++;
    } else if (!validateAmount(r.amount, isNft)) {
      invalid++;
    }
  }
  return { valid: missing === 0 && invalid === 0, missingCount: missing, invalidCount: invalid };
}
