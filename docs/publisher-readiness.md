# Publisher Readiness Guide

## 1. Versioning Strategy
- **Format**: `Major.Minor.Patch` (e.g., `1.0.0`).
- **Versioning**:
    - Update `version` in `app.json`.
    - Update `android.versionCode` in `app.json` (or use `autoIncrement` in `eas.json`).

## 2. APK Naming Convention
When downloading artifacts from EAS, rename them for clarity before uploading:
- `bulkblast-v1.0.0-production.apk` (or `.aab`)
- `bulkblast-v1.0.0-preview.apk`

## 3. Changelog Template (CHANGELOG.md)

### v1.0.0 (Launch)
- Initial release of BulkBlast.
- Feature: Bulk send SOL and SPL tokens.
- Feature: CSV recipient import.
- Feature: Built-in Jupiter Swap.
- Feature: Transaction history and CSV export.

## 4. Support Assets
- **Privacy Policy**: Host a simple MD file on GitHub Pages or Notion.
- **Terms of Service**: Standard disclaimer (Not financial advice, self-custody risk).

## 5. Final Sanity Check
- [ ] Keys are hidden (`.env` not in git).
- [ ] `eas.json` has correct package name.
- [ ] `app.json` has correct bundle identifier.
- [ ] Release build installs and runs on a real device.
