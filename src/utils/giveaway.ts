import type { Recipient } from '../types/recipient';

/**
 * Randomly selects unique winners from a list of recipients.
 * Only valid recipients are considered.
 * Duplicates (by address) are removed before selection to ensure fairness.
 */
export function pickRandomRecipients({
  recipients,
  count,
}: {
  recipients: Recipient[];
  count: number;
}): Recipient[] {
  // 1. Filter valid recipients
  const validRecipients = recipients.filter((r) => r.isValid);

  // 2. Remove duplicates by address to ensure equal probability per wallet
  const uniqueRecipients = Array.from(
    new Map(validRecipients.map((r) => [r.address, r])).values()
  );

  if (count > uniqueRecipients.length) {
    throw new Error(
      `Cannot pick ${count} winners from ${uniqueRecipients.length} valid unique recipients.`
    );
  }

  if (count <= 0) {
    return [];
  }

  // 3. Fisher-Yates Shuffle
  const shuffled = [...uniqueRecipients];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // 4. Return top N
  return shuffled.slice(0, count);
}
