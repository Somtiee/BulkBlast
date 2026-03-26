/**
 * Bags.fm token launch — builds metadata + unsigned launch transaction via @bagsfm/bags-sdk.
 * UI can sign `serializedTransaction` with the connected wallet and broadcast.
 */

import type { ImageInput } from '@bagsfm/bags-sdk';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import {
  BAGS_PROXY_BASE_URL,
  BAGS_DEFAULT_FEE_CONFIG_TYPE,
  MAX_BAGS_TOKEN_DESCRIPTION_LEN,
  MAX_BAGS_TOKEN_NAME_LEN,
  MAX_BAGS_TOKEN_SYMBOL_LEN,
} from '../constants/bags';
import { getConnection } from './SolanaService';
import { signTransaction } from './WalletService';

/** Social links forwarded to Bags token metadata. */
export type BagsLaunchSocialLinks = {
  twitter?: string;
  telegram?: string;
  website?: string;
};

/**
 * React Native multipart file shape accepted by RN FormData.
 * We use this instead of Node-only buffers for mobile uploads.
 */
type ReactNativeMultipartFile = {
  uri: string;
  name: string;
  type: string;
};

/** Progress phases for UI (metadata → on-chain partner config check → launch tx build). */
export type BagsLaunchProgressStep = 'metadata' | 'feeConfig' | 'launchTx';

export type LaunchTokenWithPartnerParams = {
  /** Local image upload (RN multipart file or SDK-compatible image input). Omit if using `imageUrl`. */
  imageFile?: ReactNativeMultipartFile | ImageInput;
  /** Public image URL. Omit if using `imageFile`. */
  imageUrl?: string;
  name: string;
  symbol: string;
  description: string;
  socialLinks?: BagsLaunchSocialLinks;
  /** Lamports for the bundled initial buy on launch (default 0). */
  initialBuyLamports?: number;
  /** Connected wallet that will sign & pay for launch. */
  publicKey: PublicKey;
  /** Optional RPC; defaults to app Helius / public mainnet from SolanaService. */
  connection?: Connection;
  /** Called as each phase starts (for step indicators in the UI). */
  onProgress?: (step: BagsLaunchProgressStep) => void;
};

export type LaunchTokenWithPartnerResult = {
  /** Unsigned `VersionedTransaction` bytes — sign with launch wallet, then send. */
  serializedTransaction: Uint8Array;
  /** Same as `serializedTransaction`, base64-encoded (useful for some wallet flows). */
  serializedTransactionBase64: string;
  /** New mint address (base58). */
  tokenMint: string;
  /** Metadata URI returned by Bags (IPFS / gateway); used internally for the launch tx. */
  tokenMetadataUri: string;
};

export class BagsLaunchServiceError extends Error {
  constructor(
    message: string,
    public readonly code: 'CONFIG' | 'VALIDATION' | 'METADATA' | 'LAUNCH_TX' | 'UNKNOWN',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BagsLaunchServiceError';
  }
}

const BAGS_HTTP_TIMEOUT_MS = 20000;
const BAGS_CONFIRM_TIMEOUT_MS = 25000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = BAGS_HTTP_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function requireLaunchConfig(): void {
  if (!BAGS_PROXY_BASE_URL.trim()) {
    throw new BagsLaunchServiceError(
      'Bags proxy base URL missing. Set EXPO_PUBLIC_PROXY_BASE_URL so the client can call /bags/* via your proxy.',
      'CONFIG',
    );
  }
}

function validateImageSource(
  imageFile: ReactNativeMultipartFile | ImageInput | undefined,
  imageUrl: string | undefined,
): void {
  const hasFile = imageFile != null;
  const hasUrl = typeof imageUrl === 'string' && imageUrl.trim().length > 0;
  if (!hasFile && !hasUrl) {
    throw new BagsLaunchServiceError('Provide either imageFile or imageUrl.', 'VALIDATION');
  }
  if (hasFile && hasUrl) {
    throw new BagsLaunchServiceError('Provide only one of imageFile or imageUrl.', 'VALIDATION');
  }
}

function normalizeOptionalUrl(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  const t = s.trim();
  return t.length > 0 ? t : undefined;
}

function isReactNativeMultipartFile(input: unknown): input is ReactNativeMultipartFile {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as Partial<ReactNativeMultipartFile>;
  return (
    typeof candidate.uri === 'string' &&
    candidate.uri.length > 0 &&
    typeof candidate.name === 'string' &&
    candidate.name.length > 0 &&
    typeof candidate.type === 'string' &&
    candidate.type.length > 0
  );
}

function extractApiErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.error === 'string' && obj.error.trim().length > 0) return obj.error;
  if (typeof obj.message === 'string' && obj.message.trim().length > 0) return obj.message;
  if (typeof obj.response === 'string' && obj.response.trim().length > 0) return obj.response;
  return undefined;
}

type TxWithBlockhash = {
  transaction: string;
  blockhash: { blockhash: string; lastValidBlockHeight: number };
};

type FeeShareConfigV2Response = {
  needsCreation: boolean;
  feeShareAuthority: string;
  meteoraConfigKey: string;
  transactions: TxWithBlockhash[] | null;
  bundles: TxWithBlockhash[][] | null;
};

async function postFeeShareConfig(
  body: Record<string, unknown>,
): Promise<FeeShareConfigV2Response> {
  const response = await fetchWithTimeout(`${BAGS_PROXY_BASE_URL}/fee-share/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const detail = extractApiErrorMessage(parsed) ?? text ?? `HTTP ${response.status}`;
    throw new Error(detail);
  }

  const envelope = (parsed ?? {}) as Record<string, unknown>;
  if (envelope.success !== true) {
    const detail = extractApiErrorMessage(parsed) ?? text ?? 'Fee-share config request failed';
    throw new Error(detail);
  }
  const inner = envelope.response;
  if (!inner || typeof inner !== 'object') {
    throw new Error('Unexpected fee-share config response shape.');
  }
  return inner as FeeShareConfigV2Response;
}

async function confirmLaunchAuxTx(
  connection: Connection,
  signature: string,
  blockhash: { blockhash: string; lastValidBlockHeight: number },
): Promise<void> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Aux tx confirmation timeout')), BAGS_CONFIRM_TIMEOUT_MS),
  );

  try {
    const confirmation = await Promise.race([
      connection.confirmTransaction(
        {
          signature,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        },
        'confirmed',
      ),
      timeoutPromise,
    ]);
    if (confirmation.value.err) {
      throw new Error('Aux tx failed on chain');
    }
    return;
  } catch {
    // fall through to status polling
  }

  const started = Date.now();
  while (Date.now() - started < BAGS_CONFIRM_TIMEOUT_MS) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status?.err) {
      throw new Error('Aux tx failed on chain');
    }
    if (
      status?.confirmationStatus === 'processed' ||
      status?.confirmationStatus === 'confirmed' ||
      status?.confirmationStatus === 'finalized'
    ) {
      return;
    }
    await sleep(900);
  }

  throw new Error('Aux tx confirmation timed out');
}

async function signAndSendVersionedTxList(
  connection: Connection,
  items: TxWithBlockhash[] | null | undefined,
): Promise<void> {
  if (!items?.length) return;
  for (const item of items) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(bs58.decode(item.transaction));
    } catch (e) {
      throw new Error(
        `Failed to decode fee-share transaction: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    await signTransaction(tx);
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      maxRetries: 3,
      skipPreflight: false,
    });
    await confirmLaunchAuxTx(connection, sig, item.blockhash);
  }
}

/**
 * Bags launch tx expects the Meteora **fee-share config** pubkey (`meteoraConfigKey`), not the partner PDA.
 * See https://docs.bags.fm/api-reference/create-fee-share-configuration
 */
async function ensureMeteoraFeeShareConfigKey(
  connection: Connection,
  launchWallet: PublicKey,
  tokenMint: PublicKey,
): Promise<string> {
  const body: Record<string, unknown> = {
    payer: launchWallet.toBase58(),
    baseMint: tokenMint.toBase58(),
    claimersArray: [launchWallet.toBase58()],
    basisPointsArray: [10000],
    bagsConfigType: BAGS_DEFAULT_FEE_CONFIG_TYPE,
  };
  // Worker injects partner fee config server-side when configured.
  const res = await postFeeShareConfig(body);

  if (res.needsCreation) {
    if (res.bundles?.length) {
      for (const bundle of res.bundles) {
        await signAndSendVersionedTxList(connection, bundle);
      }
    }
    await signAndSendVersionedTxList(connection, res.transactions);
  }

  const key = res.meteoraConfigKey?.trim();
  if (!key) {
    throw new Error('Fee-share response missing meteoraConfigKey.');
  }
  return key;
}

async function createTokenInfoAndMetadata(
  input:
    | {
        imageFile: ReactNativeMultipartFile | ImageInput;
        imageUrl?: undefined;
        name: string;
        symbol: string;
        description: string;
        twitter?: string;
        telegram?: string;
        website?: string;
      }
    | {
        imageFile?: undefined;
        imageUrl: string;
        name: string;
        symbol: string;
        description: string;
        twitter?: string;
        telegram?: string;
        website?: string;
      },
): Promise<{ tokenMint: string; tokenMetadata: string }> {
  const formData = new FormData();
  if (input.imageUrl) {
    formData.append('imageUrl', input.imageUrl);
  } else if (input.imageFile) {
    if (isReactNativeMultipartFile(input.imageFile)) {
      formData.append('image', {
        uri: input.imageFile.uri,
        name: input.imageFile.name,
        type: input.imageFile.type,
      } as unknown as Blob);
    } else {
      // Fallback for non-RN callers that pass a Blob/File-like object.
      formData.append('image', input.imageFile as unknown as Blob);
    }
  }

  formData.append('name', input.name);
  formData.append('symbol', input.symbol);
  formData.append('description', input.description);
  if (input.telegram) formData.append('telegram', input.telegram);
  if (input.twitter) formData.append('twitter', input.twitter);
  if (input.website) formData.append('website', input.website);

  const response = await fetchWithTimeout(`${BAGS_PROXY_BASE_URL}/token-launch/create-token-info`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const detail = extractApiErrorMessage(parsed) ?? text ?? `HTTP ${response.status}`;
    throw new Error(detail);
  }

  const envelope = (parsed ?? {}) as Record<string, unknown>;
  const inner =
    envelope.response && typeof envelope.response === 'object'
      ? (envelope.response as Record<string, unknown>)
      : envelope;

  const tokenMint =
    typeof inner.tokenMint === 'string'
      ? inner.tokenMint
      : typeof envelope.tokenMint === 'string'
      ? envelope.tokenMint
      : '';
  const tokenMetadata =
    typeof inner.tokenMetadata === 'string'
      ? inner.tokenMetadata
      : typeof envelope.tokenMetadata === 'string'
      ? envelope.tokenMetadata
      : '';

  if (!tokenMint.trim() || !tokenMetadata.trim()) {
    throw new Error('Bags API returned malformed token metadata response.');
  }

  return { tokenMint, tokenMetadata };
}

async function createLaunchTransaction(
  payload: {
    metadataUrl: string;
    tokenMint: string;
    launchWallet: string;
    initialBuyLamports: number;
    configKey: string;
  },
): Promise<VersionedTransaction> {
  const response = await fetchWithTimeout(`${BAGS_PROXY_BASE_URL}/token-launch/create-launch-transaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      ipfs: payload.metadataUrl,
      tokenMint: payload.tokenMint,
      wallet: payload.launchWallet,
      initialBuyLamports: payload.initialBuyLamports,
      configKey: payload.configKey,
    }),
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const detail = extractApiErrorMessage(parsed) ?? text ?? `HTTP ${response.status}`;
    throw new Error(detail);
  }

  const envelope = (parsed ?? {}) as Record<string, unknown>;
  const encoded =
    typeof envelope.response === 'string'
      ? envelope.response
      : typeof envelope.transaction === 'string'
      ? envelope.transaction
      : typeof envelope.data === 'string'
      ? envelope.data
      : '';

  if (!encoded.trim()) {
    throw new Error('Bags API returned malformed launch transaction response.');
  }

  try {
    const txBytes = bs58.decode(encoded.trim());
    return VersionedTransaction.deserialize(txBytes);
  } catch (e) {
    throw new Error(
      `Failed to decode launch transaction: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Create token metadata on Bags, then request the partner-config launch transaction.
 * Does not sign or send — caller uses WalletService / adapter on `serializedTransaction`.
 */
export async function launchTokenWithPartner(
  params: LaunchTokenWithPartnerParams,
): Promise<LaunchTokenWithPartnerResult> {
  requireLaunchConfig();
  validateImageSource(params.imageFile, params.imageUrl);

  const name = params.name?.trim() ?? '';
  const symbol = params.symbol?.trim() ?? '';
  const description = params.description?.trim() ?? '';
  if (!name) {
    throw new BagsLaunchServiceError('Token name is required.', 'VALIDATION');
  }
  if (!symbol) {
    throw new BagsLaunchServiceError('Token symbol is required.', 'VALIDATION');
  }
  if (name.length > MAX_BAGS_TOKEN_NAME_LEN) {
    throw new BagsLaunchServiceError(
      `Token name must be at most ${MAX_BAGS_TOKEN_NAME_LEN} characters.`,
      'VALIDATION',
    );
  }
  if (symbol.length > MAX_BAGS_TOKEN_SYMBOL_LEN) {
    throw new BagsLaunchServiceError(
      `Symbol must be at most ${MAX_BAGS_TOKEN_SYMBOL_LEN} characters.`,
      'VALIDATION',
    );
  }
  if (!description) {
    throw new BagsLaunchServiceError('Description is required.', 'VALIDATION');
  }
  if (description.length > MAX_BAGS_TOKEN_DESCRIPTION_LEN) {
    throw new BagsLaunchServiceError(
      `Description must be at most ${MAX_BAGS_TOKEN_DESCRIPTION_LEN} characters.`,
      'VALIDATION',
    );
  }

  const connection = params.connection ?? getConnection();

  const social = params.socialLinks ?? {};
  const twitter = normalizeOptionalUrl(social.twitter);
  const telegram = normalizeOptionalUrl(social.telegram);
  const website = normalizeOptionalUrl(social.website);

  const initialBuyLamports = Math.max(0, Math.floor(params.initialBuyLamports ?? 0));

  const metadataPayload =
    params.imageUrl != null && params.imageUrl.trim().length > 0
      ? {
          imageUrl: params.imageUrl.trim(),
          name,
          symbol,
          description,
          ...(twitter ? { twitter } : {}),
          ...(telegram ? { telegram } : {}),
          ...(website ? { website } : {}),
        }
      : {
          imageFile: params.imageFile as ReactNativeMultipartFile | ImageInput,
          name,
          symbol,
          description,
          ...(twitter ? { twitter } : {}),
          ...(telegram ? { telegram } : {}),
          ...(website ? { website } : {}),
        };

  let tokenMint: string;
  let tokenMetadataUri: string;

  try {
    params.onProgress?.('metadata');
    const created = await createTokenInfoAndMetadata(metadataPayload);
    tokenMint = created.tokenMint;
    tokenMetadataUri = created.tokenMetadata;
    if (!tokenMint?.trim()) {
      throw new Error('Bags API returned empty tokenMint');
    }
    if (!tokenMetadataUri?.trim()) {
      throw new Error('Bags API returned empty tokenMetadata URI');
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new BagsLaunchServiceError(
      `Failed to create token info / metadata: ${message}`,
      'METADATA',
      e,
    );
  }

  let meteoraConfigKey: string;
  try {
    params.onProgress?.('feeConfig');
    meteoraConfigKey = await ensureMeteoraFeeShareConfigKey(
      connection,
      params.publicKey,
      new PublicKey(tokenMint),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new BagsLaunchServiceError(
      `Failed to set up fee-share config (required before launch): ${message}`,
      'CONFIG',
      e,
    );
  }

  let launchTx: VersionedTransaction;
  try {
    params.onProgress?.('launchTx');
    launchTx = await createLaunchTransaction({
      metadataUrl: tokenMetadataUri,
      tokenMint,
      launchWallet: params.publicKey.toBase58(),
      initialBuyLamports,
      configKey: meteoraConfigKey,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new BagsLaunchServiceError(
      `Failed to create launch transaction: ${message}`,
      'LAUNCH_TX',
      e,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = launchTx.serialize();
  } catch (e) {
    throw new BagsLaunchServiceError('Failed to serialize launch transaction.', 'LAUNCH_TX', e);
  }

  const serializedTransactionBase64 = Buffer.from(bytes).toString('base64');

  return {
    serializedTransaction: new Uint8Array(bytes),
    serializedTransactionBase64,
    tokenMint,
    tokenMetadataUri,
  };
}

/**
 * Deserialize bytes from `launchTokenWithPartner` back to a VersionedTransaction (e.g. for signing).
 */
export function deserializeLaunchTransaction(serialized: Uint8Array): VersionedTransaction {
  return VersionedTransaction.deserialize(serialized);
}
