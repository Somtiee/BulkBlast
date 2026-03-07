export function isProbablyPrivateKey(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 16) return false;
  if (/\s/.test(trimmed)) return false;
  return true;
}

export function makeMockPublicKey(prefix: string, seed: string): string {
  const normalizedPrefix = prefix.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'MOCK';
  const normalizedSeed = seed.replace(/\s+/g, '').slice(0, 10);
  return `${normalizedPrefix}_${normalizedSeed}_${stableHash(seed).slice(0, 16)}`;
}

function stableHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')).toLowerCase();
}
