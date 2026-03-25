import * as ExpoSecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { Keypair, VersionedTransaction, Transaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import * as naclUtil from 'tweetnacl-util';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import { StorageService, KEYS } from './StorageService';

// --- SecureStore Adapter for Web Support ---
const SecureStore = {
  getItemAsync: async (key: string, options?: ExpoSecureStore.SecureStoreOptions) => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return ExpoSecureStore.getItemAsync(key, options);
  },
  setItemAsync: async (key: string, value: string, options?: ExpoSecureStore.SecureStoreOptions) => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    return ExpoSecureStore.setItemAsync(key, value, options);
  },
  deleteItemAsync: async (key: string, options?: ExpoSecureStore.SecureStoreOptions) => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    return ExpoSecureStore.deleteItemAsync(key, options);
  },
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: ExpoSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
// -------------------------------------------

const SECURE_STORE_PREFIX = 'bulkblast.wallet.';
const KEY_ENCRYPTION_KEY = SECURE_STORE_PREFIX + 'encryption_key'; // 32 bytes, base64
const KEY_ENCRYPTED_SECRET = SECURE_STORE_PREFIX + 'secret_blob'; // nonce(24) + ciphertext
const KEY_PUBLIC_KEY = SECURE_STORE_PREFIX + 'public_key';

// In-memory wallet instance (cleared on lock)
let currentKeypair: Keypair | null = null;

type BuiltInUnlockListener = (publicKey: string) => void;
const builtInUnlockListeners = new Set<BuiltInUnlockListener>();

/** Register to sync app state when the user unlocks (e.g. biometric during signing). */
export function registerBuiltInUnlockListener(fn: BuiltInUnlockListener): () => void {
  builtInUnlockListeners.add(fn);
  return () => {
    builtInUnlockListeners.delete(fn);
  };
}

function notifyBuiltInUnlocked(publicKey: string) {
  builtInUnlockListeners.forEach((fn) => {
    try {
      fn(publicKey);
    } catch {
      /* ignore listener errors */
    }
  });
}

// Helper to encode/decode
const encodeBase64 = (arr: Uint8Array) => naclUtil.encodeBase64(arr);
const decodeBase64 = (str: string) => naclUtil.decodeBase64(str);

/**
 * Initializes or retrieves the app-specific encryption key.
 * This key is stored in SecureStore and used to encrypt the actual wallet private key.
 */
async function getOrInitEncryptionKey(): Promise<Uint8Array> {
  let keyB64 = await SecureStore.getItemAsync(KEY_ENCRYPTION_KEY);
  if (!keyB64) {
    const randomBytes = await Crypto.getRandomBytesAsync(nacl.secretbox.keyLength);
    keyB64 = encodeBase64(randomBytes);
    await SecureStore.setItemAsync(KEY_ENCRYPTION_KEY, keyB64, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  return decodeBase64(keyB64);
}

/**
 * Encrypts a secret key (Uint8Array) and stores it in SecureStore.
 */
async function encryptAndStoreWallet(secretKey: Uint8Array, publicKey: string) {
  const encryptionKey = await getOrInitEncryptionKey();
  const nonce = await Crypto.getRandomBytesAsync(nacl.secretbox.nonceLength);
  
  const ciphertext = nacl.secretbox(secretKey, nonce, encryptionKey);
  
  // Store format: base64(nonce + ciphertext)
  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce);
  blob.set(ciphertext, nonce.length);
  
  const blobB64 = encodeBase64(blob);
  
  await SecureStore.setItemAsync(KEY_ENCRYPTED_SECRET, blobB64, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await SecureStore.setItemAsync(KEY_PUBLIC_KEY, publicKey, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function loadKeypairFromStorage(): Promise<Keypair> {
  const encryptionKey = await getOrInitEncryptionKey();
  const blobB64 = await SecureStore.getItemAsync(KEY_ENCRYPTED_SECRET);
  if (!blobB64) {
    throw new Error('No wallet found');
  }

  const blob = decodeBase64(blobB64);
  const nonce = blob.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = blob.slice(nacl.secretbox.nonceLength);

  const secretKey = nacl.secretbox.open(ciphertext, nonce, encryptionKey);
  if (!secretKey) {
    throw new Error('Decryption failed');
  }

  return Keypair.fromSecretKey(secretKey);
}

export async function hasBuiltInWallet(): Promise<boolean> {
  const pub = await SecureStore.getItemAsync(KEY_PUBLIC_KEY);
  return !!pub;
}

export async function getBuiltInPublicKey(): Promise<string | null> {
  return await SecureStore.getItemAsync(KEY_PUBLIC_KEY);
}

export async function createBuiltIn(): Promise<{ publicKey: string }> {
  const kp = Keypair.generate();
  await encryptAndStoreWallet(kp.secretKey, kp.publicKey.toBase58());
  
  // Auto-unlock on creation
  currentKeypair = kp;
  return { publicKey: kp.publicKey.toBase58() };
}

export async function importBuiltIn(secretKey: Uint8Array): Promise<{ publicKey: string }> {
  const kp = Keypair.fromSecretKey(secretKey);
  await encryptAndStoreWallet(kp.secretKey, kp.publicKey.toBase58());
  
  // Auto-unlock on import
  currentKeypair = kp;
  return { publicKey: kp.publicKey.toBase58() };
}

export async function importBuiltInWalletFromBase58(secretKeyBase58: string): Promise<{ publicKey: string }> {
  try {
    const secretKey = bs58.decode(secretKeyBase58);
    if (secretKey.length !== 64) {
      throw new Error(`Invalid secret key length. Expected 64 bytes, got ${secretKey.length}.`);
    }
    return await importBuiltIn(secretKey);
  } catch (e: any) {
    throw new Error('Invalid Base58 private key: ' + e.message);
  }
}

export async function importBuiltInWalletFromJsonArray(secretKeyJson: string): Promise<{ publicKey: string }> {
  try {
    const parsed = JSON.parse(secretKeyJson);
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new Error('Invalid JSON format (expected array of 64 bytes)');
    }
    const secretKey = Uint8Array.from(parsed);
    return await importBuiltIn(secretKey);
  } catch (e: any) {
    throw new Error('Invalid JSON private key: ' + e.message);
  }
}

export async function importAnyWallet(input: string): Promise<{ publicKey: string }> {
  const trimmed = input.trim();
  
  // Try to auto-detect format
  const isJson = trimmed.startsWith('[') && trimmed.endsWith(']');
  
  if (isJson) {
    try {
      return await importBuiltInWalletFromJsonArray(trimmed);
    } catch (jsonError: any) {
      // If it looks like JSON but fails, it might be a weird Base58 string wrapped in brackets? Unlikely.
      // But let's try Base58 as a fallback just in case, or throw the JSON error.
      throw jsonError;
    }
  } else {
    // Assume Base58
    try {
      return await importBuiltInWalletFromBase58(trimmed);
    } catch (base58Error: any) {
      // If Base58 fails, check if it might be a JSON array without brackets?
      if (trimmed.includes(',')) {
         try {
            // Try wrapping in brackets
            return await importBuiltInWalletFromJsonArray(`[${trimmed}]`);
         } catch (e) {}
      }
      throw base58Error;
    }
  }
}

export async function lockBuiltIn(): Promise<void> {
  currentKeypair = null;
}

export async function unlockBuiltIn(): Promise<{ publicKey: string }> {
  if (currentKeypair) {
    return { publicKey: currentKeypair.publicKey.toBase58() };
  }

  // Require device authentication (biometrics and/or device PIN/password) before loading keys — same idea as Phantom.
  if (Platform.OS !== 'web') {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock your wallet (fingerprint, face, or device passcode)',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    if (!result.success) {
      throw new Error(
        result.error === 'user_cancel' ? 'Authentication cancelled' : 'Authentication failed'
      );
    }
  }

  const kp = await loadKeypairFromStorage();
  currentKeypair = kp;
  const publicKey = kp.publicKey.toBase58();
  await StorageService.setItem(KEYS.WALLET_LOCKED, 'false');
  notifyBuiltInUnlocked(publicKey);
  return { publicKey };
}

export async function unlockBuiltInSilently(): Promise<{ publicKey: string }> {
  if (currentKeypair) {
    return { publicKey: currentKeypair.publicKey.toBase58() };
  }

  const kp = await loadKeypairFromStorage();
  currentKeypair = kp;
  return { publicKey: kp.publicKey.toBase58() };
}

export async function signTransaction(transaction: Transaction | VersionedTransaction): Promise<Transaction | VersionedTransaction> {
  if (!currentKeypair) {
    await unlockBuiltIn();
  }
  if (!currentKeypair) {
    throw new Error('Wallet is locked');
  }

  // Check if it's a VersionedTransaction
  if ('version' in transaction) {
    // VersionedTransaction signing
    transaction.sign([currentKeypair]);
    return transaction;
  } else {
    // Legacy Transaction signing
    transaction.partialSign(currentKeypair);
    return transaction;
  }
}

export async function signVersionedTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction> {
  if (!currentKeypair) {
    await unlockBuiltIn();
  }
  if (!currentKeypair) {
    throw new Error('Wallet is locked');
  }
  transaction.sign([currentKeypair]);
  return transaction;
}

export async function wipeBuiltInWallet(): Promise<void> {
  // Check auth before wiping
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();

  if (hasHardware && isEnrolled) {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Confirm Wipe Wallet',
      fallbackLabel: 'Use Passcode',
    });
    if (!result.success) {
      throw new Error('Authentication failed');
    }
  }

  await SecureStore.deleteItemAsync(KEY_ENCRYPTION_KEY);
  await SecureStore.deleteItemAsync(KEY_ENCRYPTED_SECRET);
  await SecureStore.deleteItemAsync(KEY_PUBLIC_KEY);
  currentKeypair = null;
}

export async function connectAdapter(): Promise<{ publicKey: string }> {
  throw new Error('External wallet connection is not implemented yet. Use the built-in wallet.');
}

export async function exportPrivateKeyBase58(): Promise<string> {
  if (!currentKeypair) {
    await unlockBuiltIn();
  }
  if (!currentKeypair) {
    throw new Error('Wallet is locked');
  }
  return bs58.encode(currentKeypair.secretKey);
}

// Deprecated mock, removing exports not needed or aliasing
export const importPrivateKey = async (opts: { privateKey: string }) => {
    // Legacy support or just forward to base58 import
    return importBuiltInWalletFromBase58(opts.privateKey);
};
