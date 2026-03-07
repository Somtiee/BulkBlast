import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import type { DropReceipt } from '../types/receipt';

export async function exportReceiptCsv(receipt: DropReceipt): Promise<{ fileUri: string; fileName: string }> {
  const csv = receiptToCsv(receipt);
  const fileName = `BulkBlast_${receipt.network}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 15)}_${receipt.id.slice(0, 8)}.csv`;
  const fileUri = `${FileSystem.documentDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/csv',
      dialogTitle: 'Export BulkBlast Receipt',
      UTI: 'public.comma-separated-values-text',
    });
  }

  return { fileUri, fileName };
}

function receiptToCsv(receipt: DropReceipt): string {
  const columns = [
    'drop_id',
    'created_at_iso',
    'network',
    'sender_pubkey',
    'asset_kind',
    'asset_mint',
    'asset_decimals',
    'recipient_index',
    'recipient_address',
    'recipient_amount_ui',
    'batch_index',
    'batch_status',
    'signature',
    'error',
  ];

  const rows: string[] = [columns.join(',')];

  const batchByRecipientId = new Map<string, { batchIndex: number; ok: boolean; signature?: string; error?: string }>();
  if (receipt.batches) {
    for (const b of receipt.batches) {
      const ids = b.recipientIds || [];
      for (const id of ids) {
        batchByRecipientId.set(id, {
          batchIndex: b.batchIndex,
          ok: b.ok,
          signature: b.signature,
          error: b.error,
        });
      }
    }
  }

  const recipients = receipt.recipients || [];
  recipients.forEach((r, index) => {
    const meta = batchByRecipientId.get(r.id);
    const batchIndex = meta ? String(meta.batchIndex + 1) : '';
    const batchStatus = meta ? (meta.ok ? 'success' : 'failed') : '';
    const signature = meta?.signature || '';
    const error = meta?.error || '';
    
    // Determine amount: use per-recipient amount if available, else fallback to totalAmountUi / validRecipientCount if uniform? 
    // Actually, DropReceipt doesn't store uniform amount easily if not in recipient list.
    // But our recipient list snapshot in receipt.recipients should have the amount.
    const amount = r.amount || '';

    const row = [
      receipt.id,
      new Date(receipt.createdAt).toISOString(),
      receipt.network,
      receipt.walletPublicKey,
      receipt.asset.kind,
      receipt.asset.kind === 'SPL' ? (receipt.asset.mint || '') : '',
      String(receipt.asset.kind === 'SPL' ? receipt.asset.decimals : 9),
      String(index + 1),
      r.address,
      amount,
      batchIndex,
      batchStatus,
      signature,
      error,
    ].map(safe).join(',');

    rows.push(row);
  });

  return rows.join('\n');
}

function safe(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
