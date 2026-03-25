# Submission Notes & Reminders

## 1. Build Artifacts
- **Production Build**: Always use `--profile production` for the store.
  ```bash
  eas build -p android --profile production
  ```
  This generates an `.aab` (Android App Bundle), which is required by the Play Store and Solana dApp Store.

- **Preview Build**: Use `--profile preview` for testing on your own device.
  ```bash
  eas build -p android --profile preview
  ```
  This generates an `.apk`.

## 2. Secrets Management
- **Never** commit `.env` files.
- **Always** ensure proxy base URL is updated in EAS before building:
  ```bash
  eas secret:create --scope project --name EXPO_PUBLIC_PROXY_BASE_URL --value "https://bulkblast-proxy.yourname.workers.dev"
  ```

## 3. Store Listing
- **Screenshots**: Ensure status bars are clean. Use the "Demo Mode" on Android or edit them to remove the clock/battery.
- **Icon**: Must be 512x512 PNG with no transparency.
- **Feature Graphic**: 1024x500 PNG.

## 4. Post-Submission
- **Monitor Crash Reports**: Check the Google Play Console / EAS Dashboard for crash reports from users.
- **Update Cycle**:
  1. Increment version in `app.json`.
  2. Increment `android.versionCode` (or let EAS `autoIncrement` handle it).
  3. Rebuild and submit.
