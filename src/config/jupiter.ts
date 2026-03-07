// Jupiter API Configuration
// Use process.env or a build-time variable if available. 
// For Expo, this might need extra configuration (e.g. babel-plugin-dotenv),
// but we'll provide a safe fallback and helper methods.

export const JUPITER_CONFIG = {
  // Official V1 API Base URL
  BASE_URL: 'https://api.jup.ag/swap/v1',
  
  // API Key (from portal.jup.ag)
  // In a real app, this should be injected via environment variables.
  // DO NOT COMMIT REAL KEYS TO SOURCE CONTROL.
  API_KEY: (typeof process !== 'undefined' && process.env && process.env.EXPO_PUBLIC_JUPITER_API_KEY) || '', 
};

export const hasJupiterApiKey = (): boolean => {
  return !!JUPITER_CONFIG.API_KEY && JUPITER_CONFIG.API_KEY.length > 0;
};

export const getJupiterBaseUrl = (): string => {
  return JUPITER_CONFIG.BASE_URL;
};
