# Release Readiness Checklist

This document serves as the final technical gate before cutting a release build.

## 1. Environment Configuration
- [ ] **Secrets Injection**: Ensure `EXPO_PUBLIC_JUPITER_API_KEY` and `EXPO_PUBLIC_HELIUS_API_KEY` are set in EAS Secrets.
- [ ] **Network Default**: Verify the default network in `src/config/index.ts` or `SolanaService.ts` is set to `mainnet-beta` (or that the user is prompted to switch).
- [ ] **No Hardcoded Secrets**: Scan codebase for any accidentally committed API keys.

## 2. Feature Verification
- [ ] **Wallet Restore**: Test restoring a wallet from a seed phrase on a fresh install.
- [ ] **Balance Refresh**: Confirm SOL and SPL token balances load correctly on Mainnet.
- [ ] **Simulation**: Run a test transaction simulation (Safety Check) and ensure it passes/fails as expected.
- [ ] **Swap**: Verify the Jupiter swap quote loads and executes (or fails gracefully if insufficient funds).
- [ ] **History**: Ensure transaction history populates after a successful send.

## 3. UI/UX Polish
- [ ] **Splash Screen**: Confirm the custom logo animation plays smoothly on startup.
- [ ] **Icons**: Check for any missing icons (squares with 'X') in the UI.
- [ ] **Error Handling**: Verify that network errors (e.g., airplane mode) show user-friendly toasts, not raw stack traces.
- [ ] **Settings**: Ensure the "Diagnostics" section shows "Key Present: Yes" for required APIs.

## 4. Final QA
- [ ] **Clean Install**: Uninstall the old version and install the new release candidate APK.
- [ ] **Performance**: Scroll through lists (History, Recipients) to ensure no lag.
- [ ] **Deep Links**: If applicable, test opening the app via a deep link.
