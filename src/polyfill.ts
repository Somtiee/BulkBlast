import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Polyfill global.Buffer for Solana Web3
global.Buffer = Buffer;

// Polyfill TextEncoder/TextDecoder if needed (fast-text-encoding usually handles this if imported)
import 'fast-text-encoding';
