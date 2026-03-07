import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { BuiltBatch } from './TransactionService';

export type SimulationResult = {
  ok: boolean;
  results: Array<{
    batchIndex: number;
    ok: boolean;
    logs?: string[];
    error?: string;
  }>;
  summary: {
    totalBatches: number;
    failedBatches: number;
  };
};

export async function simulateBatches({
  connection,
  batches,
  feePayerPubkey,
}: {
  connection: Connection;
  batches: BuiltBatch[];
  feePayerPubkey: PublicKey;
}): Promise<SimulationResult> {
  const results: SimulationResult['results'] = [];
  let failedBatches = 0;

  // We'll process sequentially to avoid rate limits and keep it simple
  for (const batch of batches) {
    const { tx, index } = batch;

    try {
      // Ensure recent blockhash and fee payer are set
      // (They should be from TransactionService, but simulation requires them)
      if (!tx.recentBlockhash) {
         const { blockhash } = await connection.getLatestBlockhash();
         tx.recentBlockhash = blockhash;
      }
      tx.feePayer = feePayerPubkey;

      // Log transaction details for debugging
      // console.log(`Simulating Batch ${index}:`, {
      //   feePayer: tx.feePayer.toBase58(),
      //   blockhash: tx.recentBlockhash,
      //   instructions: tx.instructions.length
      // });

      // Simulate
      // Explicitly type the result to avoid 'any' if possible, or keep as is.
      // Important: simulateTransaction signature can vary by web3.js version.
      // Standard: simulateTransaction(transaction, signersOrOptions)
      const response = await connection.simulateTransaction(tx);

      if (response.value.err) {
        console.warn(`Simulation failed for batch ${index}:`, response.value.err);
        failedBatches++;
        results.push({
          batchIndex: index,
          ok: false,
          logs: response.value.logs || [],
          error: typeof response.value.err === 'string' ? response.value.err : JSON.stringify(response.value.err),
        });
      } else {
        results.push({
          batchIndex: index,
          ok: true,
          logs: response.value.logs || [],
        });
      }

    } catch (e: any) {
      failedBatches++;
      let errorMsg = e.message || 'Simulation failed unexpectedly';
      
      if (errorMsg.includes('Invalid arguments')) {
        errorMsg += ' (Check if your wallet has SOL/Funds or if recipients are valid)';
      }

      results.push({
        batchIndex: index,
        ok: false,
        error: errorMsg,
      });
    }

    // Small delay to be nice to RPC
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return {
    ok: failedBatches === 0,
    results,
    summary: {
      totalBatches: batches.length,
      failedBatches,
    },
  };
}
