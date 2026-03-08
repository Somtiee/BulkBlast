# Solana dApp Store Submission Guide

This guide explains how to submit your app to the Solana dApp Store (for Saga/Seeker devices).

## 1. Register
- Go to the [Solana Mobile Developer Portal](https://solanamobile.com/developers).
- Create an account or sign in.

## 2. Create dApp Listing
1.  Click **Submit dApp**.
2.  **Basic Info**:
    - **Name**: BulkBlast
    - **Package Name**: `com.bulkblast.app` (Must match your `app.json`).
3.  **Details**:
    - **Description**: (Use `docs/store-listing-copy.md`).
    - **Category**: DeFi / Wallet / Tool.
    - **Website**: Your landing page URL.
    - **Support Email**: `support@bulkblast.app`.

## 3. Upload Media
- **Icon**: 512x512 PNG.
- **Screenshots**: Upload your phone screenshots.
- **Banner**: 1024x500 PNG.

## 4. Upload APK/AAB
Unlike Google Play, the Solana dApp Store is more flexible but prefers APKs for direct review or AABs if they handle signing.

1.  **Artifact**: Upload the `.apk` (Preview build) OR `.aab` (Production build).
    - *Recommendation*: Upload the **APK** initially so the reviewers can install it directly without bundle processing, unless the portal explicitly asks for AAB.
    - If they ask for AAB, use the one from `eas build -p android --profile production`.

## 5. Policy Review
- Ensure your app complies with the [dApp Store Policies](https://github.com/solana-mobile/dapp-store-policies).
- Key check: You must NOT use Google Play Billing for crypto transactions (BulkBlast uses on-chain transactions, so you are compliant).

## 6. Submit
- Click **Submit for Review**.
- The Solana Mobile team will review your submission (typically faster than Google Play).
