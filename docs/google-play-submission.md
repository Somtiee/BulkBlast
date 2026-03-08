# Google Play Store Submission Guide

This guide explains how to upload your `.aab` file to the Google Play Console.

## 1. Developer Account
- Go to [Google Play Console](https://play.google.com/console).
- Sign in and pay the one-time $25 registration fee if you haven't already.
- Create your developer profile.

## 2. Create App Listing
1.  Click **Create app**.
2.  **App Name**: BulkBlast
3.  **Default Language**: English (US)
4.  **App or Game**: App
5.  **Free or Paid**: Free
6.  Accept the declarations and create the app.

## 3. Set Up Store Presence
Navigate to **Store presence > Main store listing**.
- **Short Description**: (Copy from `docs/store-listing-copy.md`)
- **Full Description**: (Copy from `docs/store-listing-copy.md`)
- **Graphics**:
    - **App Icon**: Upload your 512x512 PNG.
    - **Feature Graphic**: Upload your 1024x500 PNG.
    - **Phone Screenshots**: Upload the 2-8 screenshots you took.

## 4. Upload the Bundle (.aab)
1.  Navigate to **Release > Production**.
2.  Click **Create new release**.
3.  **App bundles**: Drag and drop the `.aab` file you downloaded from Expo EAS.
    - *Note: You must download the `.aab` to your computer first.*
4.  **Release Name**: e.g., `1.0.0`.
5.  **Release Notes**: (Copy from `docs/solana-mobile-submission.md`).

## 5. Content Rating & Policy
You must complete several questionnaires in the **App Content** section:
- **Privacy Policy**: Link to your hosted privacy policy.
- **Ads**: Select "No" (unless you add them later).
- **App Access**: "All functionality is available without special access" (or describe wallet login).
- **Content Rating**: Fill out the survey (likely "E for Everyone" or "Teen" depending on financial categorization).
- **Target Audience**: 18+.
- **Financial Features**: Declare that your app provides financial features (Cryptocurrency wallet/exchange).

## 6. Review & Rollout
1.  Go back to **Production**.
2.  Click **Next**.
3.  Review any warnings.
4.  Click **Start rollout to Production**.

Google will review your app (usually takes 1-7 days). Once approved, it will be live on the Play Store!
