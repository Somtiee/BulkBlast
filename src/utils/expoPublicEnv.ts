import Constants from 'expo-constants';

/**
 * Read EXPO_PUBLIC_* from `app.config.js` `expo.extra` (dotenv) with `process.env` fallback.
 */
export function readExpoPublic(key: string): string {
  const extra = Constants.expoConfig?.extra as Record<string, string | undefined> | undefined;
  const fromExtra = extra?.[key];
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) {
    return fromExtra.trim();
  }
  const env = typeof process !== 'undefined' && process.env ? process.env : {};
  const v = (env as Record<string, unknown>)[key];
  return typeof v === 'string' ? v.trim() : '';
}
