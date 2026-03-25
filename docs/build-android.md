# Building Android APKs with EAS

This guide explains how to generate Android APKs for testing (preview) and production releases using Expo Application Services (EAS).

## Prerequisites

1.  **Install EAS CLI**:
    ```bash
    npm install -g eas-cli
    ```

2.  **Login to Expo**:
    ```bash
    eas login
    ```

3.  **Configure Project (One-time setup)**:
    Ensure `eas.json` exists in the root directory and `app.json` has the correct `android.package` (e.g., `com.bulkblast.app`).

## Managing Secrets

**NEVER** hardcode API keys in your source code. Use EAS Secrets to securely provide environment variables during the build process.

### Required Secrets
- `EXPO_PUBLIC_PROXY_BASE_URL`: Public URL of your server-side proxy (e.g. Cloudflare Worker).

No other third-party API keys should be set in Expo/EAS anymore; the proxy holds the real secrets server-side.

### How to Set Secrets
You can set secrets using the EAS CLI:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_PROXY_BASE_URL --value "https://bulkblast-proxy.yourname.workers.dev"
```

Or manage them in the [Expo Dashboard](https://expo.dev/accounts/[account]/projects/[project]/secrets).

## Build Profiles

### 1. Preview Build (APK)
Generates an installable `.apk` file that you can side-load onto your Android device for testing.

**Command:**
```bash
eas build -p android --profile preview
```

**What it does:**
- Uses the `preview` profile from `eas.json`.
- Sets `android.buildType` to `apk`.
- Does not require a Google Play Store account setup for distribution (internal distribution).

### 2. Production Build (AAB)
Generates an Android App Bundle (`.aab`) ready for submission to the Google Play Store.

**Command:**
```bash
eas build -p android --profile production
```

**What it does:**
- Uses the `production` profile from `eas.json`.
- Optimizes the build for release.
- Generates an `.aab` file.

## Build Sanity Check

Before running a build, it is recommended to run the sanity check script to catch common issues early.

**Command:**
```bash
npm run build-check
```

**This script checks:**
1.  **TypeScript Types**: Runs `tsc` to ensure no type errors.
2.  **Linting**: Runs `eslint` (if configured) to catch code style issues.

## Troubleshooting

- **Build Fails**: Check the logs provided in the link by the EAS CLI.
- **Missing Secrets**: Ensure `EXPO_PUBLIC_PROXY_BASE_URL` is set in EAS Secrets (other API keys live in the proxy).
- **Version Code Error**: If uploading to the Play Store fails due to version code, ensure `autoIncrement` is set to `true` in `eas.json` for the production profile, or manually increment `android.versionCode` in `app.json`.
