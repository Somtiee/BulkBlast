# Solana Mobile dApp Store Submission Guide

This document outlines the requirements and steps for submitting BulkBlast to the Solana Mobile dApp Store.

## 1. Prerequisites

### Build Artifacts
- [ ] **Production APK**: Generate a release-ready APK (not just a preview build).
  ```bash
  eas build -p android --profile production
  ```
- [ ] **Keystore**: Ensure you have the keystore file used to sign the APK (managed by EAS usually, but good to back up).

### Developer Account
- [ ] **Solana Mobile Developer Portal**: Register at [solanamobile.com/developers](https://solanamobile.com/developers).
- [ ] **dApp Store Listing**: Create a new app listing in the portal.

## 2. App Metadata Checklist

### Basic Info
- [ ] **App Name**: BulkBlast
- [ ] **Package Name**: `com.bulkblast.app`
- [ ] **Version**: e.g., `1.0.0`
- [ ] **Category**: Tools / Finance / Utilities

### Visual Assets
- [ ] **App Icon**: 512x512px PNG (No transparency).
- [ ] **Feature Graphic**: 1024x500px PNG (Promotional banner).
- [ ] **Screenshots**: Minimum 3, Maximum 8 per device type (Phone/Tablet). See [screenshots-checklist.md](./screenshots-checklist.md).

### Legal & Support
- [ ] **Privacy Policy URL**: Link to hosted privacy policy (can be a simple Notion doc or GitHub page for now).
- [ ] **Support Email**: `support@bulkblast.app` (or similar).
- [ ] **Website**: `https://bulkblast.app` (or landing page).

## 3. Submission Sanity Checklist

Before clicking "Submit":

- [ ] **Mainnet Default**: Ensure `app.json` or default state points to Mainnet (or user is prompted).
- [ ] **No Debug UI**: Verify no "Debug" banners or "Yellow Box" warnings are visible in the release APK.
- [ ] **Secrets**: Confirm API keys (Jupiter, Helius) are correctly injected and working in the release build.
- [ ] **Deep Links**: If implemented, verify `solana:` or `bulkblast:` deep links open the app correctly.
- [ ] **Permissions**: Review requested Android permissions. Keep them minimal (Internet, Camera for QR scanning).

## 4. Release Notes Template

**Version 1.0.0 - Initial Release**
- **Bulk Sending**: Send SOL, SPL tokens, and NFTs to multiple recipients in one go.
- **CSV Import**: Easily import airdrop lists from CSV files.
- **Safety Checks**: Built-in validation to prevent sending to invalid addresses.
- **Swap Integration**: Powered by Jupiter for seamless asset exchanges.
- **Solana Mobile Exclusive**: Optimized for Saga, with special "Seeker" discounts.
