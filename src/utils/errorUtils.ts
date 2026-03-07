// src/utils/errorUtils.ts
import { Logger } from './Logger';

export function sanitizeError(error: any): string {
  if (!error) return 'Unknown error occurred.';

  const msg = error.message || error.toString();

  // Log full error for debug
  Logger.error('Sanitized error:', error);

  // Filter sensitive patterns
  if (msg.match(/key|secret|password|mnemonic|seed/i)) {
    return 'An error occurred. Details have been logged for security.';
  }

  // Common RPC errors cleanup
  if (msg.includes('429')) return 'Network is busy (Rate Limit). Please try again later.';
  if (msg.includes('Network request failed')) return 'Network connection failed. Please check your internet.';
  if (msg.includes('insufficient lamports')) return 'Insufficient SOL balance for transaction.';
  if (msg.includes('Blockhash not found')) return 'Transaction timed out. Please try again.';

  // If message is too technical (contains stack trace indicators or huge JSON), simplify
  if (msg.length > 200 || msg.includes('{"')) {
    return 'A technical error occurred. Please try again.';
  }

  return msg;
}
