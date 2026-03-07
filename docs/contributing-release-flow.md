# Contributing & Release Workflow

## 1. Environment Setup
- Copy `.env.example` to `.env`.
- Fill in your API keys (Helius, Jupiter).
- **NEVER** commit `.env` or real API keys to the repository.

## 2. Development Workflow
- Create a feature branch for new work: `git checkout -b feature/my-new-feature`.
- Make small, atomic commits.
- Ensure TypeScript types check passes.

## 3. Pre-Release Checklist
Before pushing to `main` or creating a release tag, run through the [Pre-Push Checklist](./pre-push-checklist.md).

## 4. Release Process
1. **Security Audit**: Verify no secrets are hardcoded.
2. **Tagging**: Create a git tag for the release version (e.g., `v1.0.0`).
   ```bash
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin v1.0.0
   ```
3. **EAS Build**: Use Expo Application Services (EAS) for production builds.
   ```bash
   eas build --platform android --profile production
   ```
   (Ensure EAS secrets are configured in the EAS dashboard, not in local files).

## 5. Hotfixes
- Create a `hotfix/` branch from the latest release tag.
- Fix the issue.
- Merge back to `main` and tag a patch release (e.g., `v1.0.1`).
