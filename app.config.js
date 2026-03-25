/**
 * Expo config:
 * - Never inline secret API keys into the client bundle.
 * - Only expose non-sensitive public values (e.g. your proxy base URL).
 */
require('dotenv').config();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const appJson = require('./app.json');

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra || {}),
      // Public-only config: points the client to your server-side proxy.
      EXPO_PUBLIC_PROXY_BASE_URL: process.env.EXPO_PUBLIC_PROXY_BASE_URL ?? '',
    },
  },
};
