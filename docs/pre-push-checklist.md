# Pre-Push / Pre-Release Checklist

Before committing or pushing to `main`, verify the following:

## 1. Security
- [ ] **No Secrets**: Verify no API keys, private keys, or mnemonics are hardcoded in source files.
- [ ] **.gitignore Check**: Ensure `.env` and `node_modules` are ignored.
- [ ] **Console Logs**: Remove or comment out debug `console.log` statements (use `Logger.debug` if needed).

## 2. Code Quality
- [ ] **Type Check**: Run `npx tsc --noEmit` to ensure no TypeScript errors.
- [ ] **Lint**: Fix any obvious linting warnings.
- [ ] **Formatting**: Ensure consistent formatting (Prettier).

## 3. Functionality
- [ ] **App Builds**: Ensure `npx expo start` runs without immediate crashes.
- [ ] **Critical Flows**:
    - Wallet creation/import works.
    - Transaction sending flow opens.
    - Settings page loads.

## 4. Environment
- [ ] **Configuration**: `app.json` version matches the intended release.
- [ ] **Environment Variables**: `.env.example` is up-to-date with any new required keys.

## 5. Clean State
- [ ] **Lockfile**: Ensure `package-lock.json` or `yarn.lock` is consistent with `package.json`.
- [ ] **Clean Install**: If in doubt, delete `node_modules` and reinstall dependencies.
