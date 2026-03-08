# Android QA Test Plan

Use this document to validate release candidates on physical Android devices.

## 1. Setup & Installation
- [ ] **Build**: Run `eas build -p android --profile preview`.
- [ ] **Install**: Download the `.apk` and install it on a physical Android device.
- [ ] **Cold Start**: Open the app. Verify splash screen appears and transitions smoothly to the Welcome/Home screen.

## 2. Core Flows Verification

### Wallet Management
- [ ] **Create Wallet**: Create a new built-in wallet. Verify mnemonic is shown.
- [ ] **Import Wallet**: Import an existing wallet via private key or seed phrase.
- [ ] **Balance Refresh**: Verify SOL and SPL token balances load correctly from the network.

### Sending Assets (Mainnet/Devnet)
- [ ] **SOL Transfer**: Send a small amount of SOL to another wallet. Confirm transaction success.
- [ ] **SPL Token Transfer**: Send an SPL token (e.g., USDC, SKR). Confirm recipient receives it.
- [ ] **NFT Transfer**: Select an NFT and send it. Verify ownership updates on-chain (e.g., via Solscan).
- [ ] **Batch Send**: Add multiple recipients (CSV or Manual). Verify all receive assets in one or more transactions.

### Swapping (Jupiter)
- [ ] **Quote**: Select a token pair (e.g., SOL -> USDC). Verify quote loads.
- [ ] **Swap Execution**: Confirm the swap. Verify balance updates.
- [ ] **Devnet Behavior**: Ensure swap is DISABLED or shows a "Not supported on Devnet" message if on Devnet.

### History & Export
- [ ] **Transaction History**: Check the History tab. Verify recent transactions appear.
- [ ] **CSV Export**: Tap export. Verify the CSV file is generated and shareable (e.g., to Google Drive or Email).

## 3. Release QA Checklist

### UI/UX Polish
- [ ] **Icons**: No missing assets/icons (squares with 'X').
- [ ] **Navigation**: Sticky logo in header returns to "Create Drop" (Home).
- [ ] **Dark Mode**: If supported, verify UI looks good in dark mode (or force light mode if not).

### Network & Logic
- [ ] **Devnet Fees**: Verify fees are waived or dummy values used on Devnet.
- [ ] **Mainnet Fees**: Verify SKR fee flow works (if enabled) or SOL fee is calculated correctly.
- [ ] **Error Handling**: Disconnect internet. Try to load portfolio. Verify user-friendly error message (no raw stack traces).

### Diagnostics (Dev Mode)
- [ ] **API Keys**: Check Settings -> Diagnostics (if visible). Ensure "Key Present" is YES for Helius/Jupiter.
- [ ] **RPC Connection**: Verify current RPC endpoint is reachable.

## 4. Final Sign-off
- [ ] **Version**: Verify `app.json` version matches the release tag.
- [ ] **Secrets**: Ensure no debug toasts or sensitive data visible in the UI.
