import { PublicKey } from '@solana/web3.js';
import { read, utils } from 'xlsx';

import type { Recipient } from '../types/recipient';

export function parseTextData(text: string): { address: string; amount?: string }[] {
  const lines = text
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);

  const result: { address: string; amount?: string }[] = [];

  for (const line of lines) {
    // Comments / notes for humans (e.g. "# Add more holders here")
    if (line.startsWith('#')) continue;

    // Check for header-like line (skip it)
    if (line.toLowerCase().startsWith('address')) continue;

    // Check if line is CSV-like (address, amount)
    // We assume if there's a comma and the second part looks like a number, it's an amount.
    const parts = line.split(',').map((p) => stripQuotes(p.trim()));
    if (parts.length >= 2) {
      const p1 = parts[1];
      // simplistic check: if p1 contains only digits and dots, it's likely an amount.
      if (/^[\d.]+$/.test(p1)) {
        const address = normalizeAddress(parts[0]);
        if (address) {
          result.push({ address, amount: p1 });
          continue; // Done with this line
        }
      }
    }

    // Fallback: treat as list of tokens (addresses)
    // This handles space-separated, semicolon-separated, or comma-separated lists of addresses
    const tokens = line.split(/[,\s;]+/g).filter(Boolean);
    for (const t of tokens) {
      const addr = normalizeAddress(t);
      if (addr) {
        result.push({ address: addr });
      }
    }
  }
  return result;
}

export function parseCsv(text: string): { address: string; amount?: string }[] {
  return parseTextData(text);
}

export function parseXlsx(base64: string): { address: string; amount?: string }[] {
  const wb = read(base64, { type: 'base64' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const data = utils.sheet_to_json<any[]>(ws, { header: 1 });

  if (!data || data.length === 0) return [];

  // Check for header
  const firstRow = data[0];
  let startIndex = 0;
  if (firstRow && firstRow[0] && typeof firstRow[0] === 'string' && firstRow[0].toLowerCase().includes('address')) {
    startIndex = 1;
  }

  const rows: { address: string; amount?: string }[] = [];
  for (let i = startIndex; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    const rawAddress = row[0];
    if (!rawAddress) continue;
    const address = String(rawAddress).trim();
    if (!address) continue;

    let amount: string | undefined;
    if (row[1] !== undefined && row[1] !== null) {
      amount = String(row[1]).trim();
    }

    rows.push({ address, amount });
  }
  return rows;
}

export function buildRecipientList(
  input: string[] | Array<{ address: string; amount?: string }>,
  source: Recipient['source']
): Recipient[] {
  if (input.length === 0) return [];

  if (typeof (input as any[])[0] === 'string') {
    return (input as string[]).map((address, index) => {
      const normalized = normalizeAddress(address);
      return {
        id: makeRecipientId(source, normalized, index),
        address: normalized,
        source,
        isValid: true,
      };
    });
  }

  return (input as Array<{ address: string; amount?: string }>).map((row, index) => {
    const normalized = normalizeAddress(row.address);
    const amount = row.amount?.trim();
    return {
      id: makeRecipientId(source, normalized, index),
      address: normalized,
      amount: amount ? amount : undefined,
      source,
      isValid: true,
    };
  });
}

export function dedupeAndValidate(recipients: Recipient[]): {
  valid: Recipient[];
  invalid: Recipient[];
  all: Recipient[];
} {
  const seen = new Set<string>();

  const all = recipients.map((r) => {
    const normalized = normalizeAddress(r.address);
    const base: Recipient = { ...r, address: normalized, error: undefined, isValid: true };

    if (!normalized) {
      return { ...base, isValid: false, error: 'invalid_address' as const };
    }

    if (seen.has(normalized)) {
      return { ...base, isValid: false, error: 'duplicate' as const };
    }

    seen.add(normalized);

    try {
      new PublicKey(normalized);
      return base;
    } catch {
      return { ...base, isValid: false, error: 'invalid_address' as const };
    }
  });

  const valid = all.filter((r) => r.isValid);
  const invalid = all.filter((r) => !r.isValid);

  return { valid, invalid, all };
}

function makeRecipientId(source: Recipient['source'], normalizedAddress: string, index: number): string {
  // Use random suffix to prevent key collisions when adding same addresses in multiple batches
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  return `${source}:${normalizedAddress}:${index}:${randomSuffix}`;
}

export function normalizeAddress(input: string): string {
  const cleaned = stripQuotes(input).trim();
  // Basic sanity check: reject if empty or extremely long/short (Solana addresses are ~32-44 chars)
  if (cleaned.length < 32 || cleaned.length > 44) return '';
  return cleaned;
}

function stripQuotes(input: string): string {
  if (!input) return '';
  return input.replace(/^["']+|["']+$/g, '');
}

export function validateRecipientsAmounts(
  recipients: Recipient[],
  mode: 'equal' | 'perRecipient',
  equalAmountUi: string,
  isNft = false
): { valid: boolean; missingCount: number; invalidCount: number } {
  const validRecipients = recipients.filter(r => r.isValid);
  if (validRecipients.length === 0) return { valid: false, missingCount: 0, invalidCount: 0 };

  let missingCount = 0;
  let invalidCount = 0;

  for (const r of validRecipients) {
    // If equal amount mode is used, we check the global amount once (conceptually)
    // But here we iterate to count potential per-recipient issues if we were in that mode.
    // Actually, simpler logic:
    
    let amountStr = '';
    if (mode === 'equal') {
       amountStr = equalAmountUi;
    } else {
       amountStr = r.amount || '';
    }

    if (!amountStr || amountStr.trim() === '') {
       missingCount++;
       continue;
    }

    const val = parseFloat(amountStr);
    if (isNaN(val) || val <= 0) {
       invalidCount++;
       continue;
    }
    
    // NFT Check: must be integer
    if (isNft && !Number.isInteger(val)) {
       invalidCount++;
    }
  }

  return {
    valid: missingCount === 0 && invalidCount === 0,
    missingCount,
    invalidCount,
  };
}
