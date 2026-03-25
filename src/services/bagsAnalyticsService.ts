/**
 * Optional partner analytics for Bags — fires after a successful on-chain launch from BulkBlast.
 * If Bags exposes a concrete endpoint later, set the path here; failures are silent (no UX impact).
 *
 * Enable with EXPO_PUBLIC_BAGS_TRACK_LAUNCHES=true (default: attempts when API key is set).
 * Disable with EXPO_PUBLIC_BAGS_TRACK_LAUNCHES=false.
 */

import { BAGS_PROXY_BASE_URL, hasBagsProxy } from '../constants/bags';
import { Logger } from '../utils/Logger';
import { readExpoPublic } from '../utils/expoPublicEnv';

/** Hypothetical partner event path — returns 404 until Bags enables it; safe to call. */
const PARTNER_LAUNCH_EVENT_PATH = '/partner/analytics/bulkblast-launch';

export type BulkBlastLaunchAnalyticsPayload = {
  mint: string;
  symbol: string;
  wallet: string;
  txSignature: string;
  /** Solana Mobile + Seeker toggle — fee discount applies on Bulk Blast Review, not launch tx */
  solanaMobileSeekerEligible: boolean;
};

function shouldAttemptTrack(): boolean {
  const flag = readExpoPublic('EXPO_PUBLIC_BAGS_TRACK_LAUNCHES');
  /** Opt-in only — avoids noisy 404s until Bags enables the endpoint */
  if (flag !== 'true' && flag !== '1') return false;
  return hasBagsProxy();
}

/**
 * Best-effort POST; never throws. Does not block UI.
 */
export async function trackBulkBlastBagsLaunch(info: BulkBlastLaunchAnalyticsPayload): Promise<void> {
  if (!shouldAttemptTrack()) return;

  const url = `${BAGS_PROXY_BASE_URL}${PARTNER_LAUNCH_EVENT_PATH}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        source: 'bulkblast',
        event: 'token_launched',
        mint: info.mint,
        symbol: info.symbol,
        wallet: info.wallet,
        txSignature: info.txSignature,
        solanaMobileSeekerEligible: info.solanaMobileSeekerEligible,
        ts: Date.now(),
      }),
    });
    if (!res.ok) {
      Logger.debug('Bags launch analytics: non-OK response', res.status);
    }
  } catch (e) {
    Logger.debug('Bags launch analytics: request failed (optional)', e);
  }
}
