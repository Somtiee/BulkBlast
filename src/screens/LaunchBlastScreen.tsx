import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  Pressable,
  Alert,
  ActivityIndicator,
  Animated,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

import type { CreateDropStackParamList } from '../navigation/types';
import { Button, Card, Chip, Input, Screen } from '../components/ui';
import { spacing, typography, useTheme } from '../theme';
import { useApp } from '../state/context';
import { getConnection, getSolBalance } from '../services/SolanaService';
import { signTransaction } from '../services/WalletService';
import {
  BagsLaunchServiceError,
  deserializeLaunchTransaction,
  launchTokenWithPartner,
  type BagsLaunchProgressStep,
} from '../services/bagsLaunchService';
import {
  MAX_BAGS_TOKEN_DESCRIPTION_LEN,
  MAX_BAGS_TOKEN_NAME_LEN,
  MAX_BAGS_TOKEN_SYMBOL_LEN,
} from '../constants/bags';
import { trackBulkBlastBagsLaunch } from '../services/bagsAnalyticsService';
import { StorageService } from '../services/StorageService';
import { sanitizeError } from '../utils/errorUtils';

function showLaunchErrorAlert(error: unknown): void {
  if (error instanceof BagsLaunchServiceError) {
    let title = 'Could not launch';
    let body = error.message;
    switch (error.code) {
      case 'CONFIG':
        title = 'Setup required';
        body =
          `${body}\n\nSet EXPO_PUBLIC_PROXY_BASE_URL to your proxy (Cloudflare Worker / backend). ` +
          `Real API keys must live only on the server-side proxy — they are not allowed in the Expo client bundle.`;
        break;
      case 'VALIDATION':
        title = 'Check your inputs';
        break;
      case 'METADATA':
        title = 'Metadata could not be created';
        body =
          'We could not create your token info on Bags. Check your image or image URL, name, and symbol.\n\n' + body;
        break;
      case 'LAUNCH_TX':
        title = 'Launch transaction failed';
        body =
          'The launch transaction could not be built. Verify your wallet and partner settings.\n\n' + body;
        break;
      default:
        body = body || 'Please try again in a moment.';
    }
    Alert.alert(title, body);
    return;
  }

  const msg = sanitizeError(error);

  if (/wallet is locked/i.test(msg)) {
    Alert.alert(
      'Wallet locked',
      'Unlock your BulkBlast in-app wallet (biometric / device PIN) to sign the launch transaction.',
    );
    return;
  }
  if (/network|fetch|Failed to fetch|ECONNREFUSED/i.test(msg)) {
    Alert.alert(
      'Connection problem',
      'Check your internet connection and RPC. If it keeps failing, try again later.',
    );
    return;
  }
  if (/Blockhash not found|blockhash|Transaction simulation failed|insufficient lamports/i.test(msg)) {
    Alert.alert(
      'Network, balance, or simulation issue',
      /insufficient lamports/i.test(msg)
        ? 'Your wallet may not have enough SOL for fees, rent, and optional initial buy. Check the yellow notice under LAUNCH & BLAST, fund your in-app wallet, tap Refresh, then retry. Failed txs still pay small network fees.'
        : 'Solana or the Bags API returned an error. Tap LAUNCH & BLAST again to retry.',
    );
    return;
  }

  Alert.alert('Something went wrong', msg);
}

type Props = NativeStackScreenProps<CreateDropStackParamList, 'LaunchBlast'>;

/** Typing safety only — Bags / your balance still enforce real limits on-chain */
const MAX_INITIAL_BUY_SOL_SANITY = 1_000_000;
const MIN_INITIAL_BUY_SOL = 0.01;
const SOL_PRESETS = ['0.01', '0.05', '0.1', '0.5', '1', '2', '5'] as const;

/**
 * Minimum SOL to keep in the launch wallet besides your optional initial buy.
 * Covers fee-share setup + launch tx (rent/fees). One Bags path needed ~0.0245 SOL in a single transfer;
 * we pad for multiple signatures and priority fees.
 */
const MIN_LAUNCH_BUFFER_SOL = 0.06;

const STEP_META: { key: BagsLaunchProgressStep; label: string }[] = [
  { key: 'metadata', label: 'Metadata' },
  { key: 'feeConfig', label: 'Fee Config' },
  { key: 'launchTx', label: 'Launch Tx' },
];

export function LaunchBlastScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { state } = useApp();
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [website, setWebsite] = useState('');
  const [initialBuySol, setInitialBuySol] = useState('0.01');

  const [imageMode, setImageMode] = useState<'file' | 'url'>('file');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageUrlPreviewFailed, setImageUrlPreviewFailed] = useState(false);
  const [imageFile, setImageFile] = useState<{
    uri: string;
    name: string;
    type: string;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [progressStep, setProgressStep] = useState<BagsLaunchProgressStep | null>(null);
  /** null = still loading; number = lamports on mainnet launch wallet */
  const [walletLamports, setWalletLamports] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const blinkOpacity = useRef(new Animated.Value(1)).current;
  const createGlowOpacity = useRef(new Animated.Value(0.65)).current;
  const createGlowScale = useRef(new Animated.Value(1)).current;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        sectionHeader: {
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
          fontWeight: typography.weight.semibold,
          color: colors.text,
          marginBottom: spacing[3],
        },
        hint: {
          fontSize: typography.fontSize.caption,
          lineHeight: typography.lineHeight.caption,
          color: colors.textSecondary,
          marginTop: spacing[2],
        },
        imagePreviewError: {
          marginTop: spacing[2],
          fontSize: typography.fontSize.caption,
          lineHeight: typography.lineHeight.caption,
          color: colors.warningText,
        },
        royaltiesNote: {
          fontSize: typography.fontSize.bodySmall,
          lineHeight: typography.lineHeight.bodySmall,
          color: colors.textSecondary,
          padding: spacing[4],
          backgroundColor: colors.surface2,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
        },
        royaltiesEmphasis: {
          color: colors.primary,
          fontWeight: typography.weight.semibold,
        },
        imageBox: {
          aspectRatio: 1,
          maxHeight: 200,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface2,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        },
        imagePreview: {
          width: '100%',
          height: '100%',
        },
        stepRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[3],
          paddingVertical: spacing[2],
        },
        stepLabel: {
          flex: 1,
          fontSize: typography.fontSize.body,
          color: colors.text,
        },
        stepLabelMuted: {
          color: colors.textSecondary,
        },
        previewCard: {
          borderWidth: 1,
          borderColor: colors.primary,
          backgroundColor: colors.surface2,
        },
        previewImage: {
          width: 72,
          height: 72,
          borderRadius: 12,
          backgroundColor: colors.surface,
        },
        previewName: {
          fontSize: typography.fontSize.body,
          fontWeight: typography.weight.bold,
          color: colors.text,
        },
        previewSymbol: {
          fontSize: typography.fontSize.caption,
          color: colors.textSecondary,
          marginTop: 2,
        },
        previewDesc: {
          fontSize: typography.fontSize.bodySmall,
          color: colors.textSecondary,
          marginTop: spacing[2],
        },
        charCount: {
          fontSize: typography.fontSize.caption,
          color: colors.textSecondary,
          marginTop: spacing[1],
          alignSelf: 'flex-end',
        },
        networkFooter: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing[2],
          paddingVertical: spacing[4],
          marginTop: spacing[2],
        },
        networkDot: {
          width: 10,
          height: 10,
          borderRadius: 5,
        },
        networkLabel: {
          fontSize: typography.fontSize.caption,
          fontWeight: typography.weight.semibold,
          color: colors.textSecondary,
        },
        bagsPoweredBy: {
          fontSize: typography.fontSize.caption,
          fontStyle: 'italic',
          color: colors.textSecondary,
          marginTop: spacing[1],
          textAlign: 'center',
        },
        createTokenWrap: {
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[2],
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[2],
          borderRadius: 999,
          borderWidth: 1,
          borderColor: colors.primary + '66',
          backgroundColor: colors.primary + '12',
          shadowColor: colors.primary,
          shadowOpacity: 0.35,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        },
        createTokenHeaderRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing[2],
          marginBottom: spacing[3],
        },
        createTokenIcon: {
          fontSize: typography.fontSize.body,
        },
        createTokenText: {
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
          fontWeight: typography.weight.bold,
          color: colors.primary,
          letterSpacing: 0.8,
        },
        historyBtn: {
          width: 40,
          height: 40,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface2,
          alignItems: 'center',
          justifyContent: 'center',
        },
        solWarningCard: {
          marginTop: spacing[3],
          padding: spacing[4],
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.warning,
          backgroundColor: colors.surface2,
        },
        solWarningTitle: {
          fontSize: typography.fontSize.bodySmall,
          fontWeight: typography.weight.bold,
          color: colors.warning,
          marginBottom: spacing[2],
        },
        solWarningBody: {
          fontSize: typography.fontSize.bodySmall,
          lineHeight: typography.lineHeight.bodySmall,
          color: colors.textSecondary,
        },
        solBalanceRow: {
          marginTop: spacing[2],
          alignItems: 'center',
        },
      }),
    [colors],
  );

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blinkOpacity, {
          toValue: 0.35,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(blinkOpacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blinkOpacity]);

  useEffect(() => {
    const glow = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(createGlowOpacity, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(createGlowScale, {
            toValue: 1.03,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(createGlowOpacity, {
            toValue: 0.6,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(createGlowScale, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    glow.start();
    return () => glow.stop();
  }, [createGlowOpacity, createGlowScale]);

  const solUi = useMemo(() => {
    const n = parseFloat(initialBuySol.replace(',', '.'));
    if (Number.isNaN(n) || n < 0) return 0;
    return Math.min(n, MAX_INITIAL_BUY_SOL_SANITY);
  }, [initialBuySol]);

  /** Lamports: fee/rent buffer + optional initial buy (integer math). */
  const requiredLamportsForLaunch = useMemo(() => {
    const buffer = Math.round(MIN_LAUNCH_BUFFER_SOL * LAMPORTS_PER_SOL);
    const buy = Math.max(0, Math.floor(solUi * LAMPORTS_PER_SOL));
    return buffer + buy;
  }, [solUi]);

  const requiredSolDisplay = useMemo(
    () => (requiredLamportsForLaunch / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, '') || '0',
    [requiredLamportsForLaunch],
  );

  const refreshLaunchWalletBalance = useCallback(async () => {
    if (!state.walletPublicKey || state.network === 'devnet') {
      setWalletLamports(null);
      return;
    }
    setBalanceLoading(true);
    try {
      const bal = await getSolBalance(state.walletPublicKey);
      setWalletLamports(bal.lamports);
    } catch {
      setWalletLamports(null);
    } finally {
      setBalanceLoading(false);
    }
  }, [state.walletPublicKey, state.network]);

  useFocusEffect(
    useCallback(() => {
      void refreshLaunchWalletBalance();
    }, [refreshLaunchWalletBalance]),
  );

  const pickImage = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const uri = asset.uri;
      const name = asset.name || 'token-image.png';
      const type = asset.mimeType || 'image/png';
      setImageUri(uri);
      setImageFile({
        uri,
        name,
        type,
      });
    } catch (e) {
      Alert.alert('Image pick failed', sanitizeError(e));
    }
  }, []);

  const clearImage = useCallback(() => {
    setImageUri(null);
    setImageFile(null);
  }, []);

  const clearImageUrl = useCallback(() => {
    setImageUrl('');
    setImageUrlPreviewFailed(false);
  }, []);

  const imageUrlTrimmed = imageUrl.trim();
  const imageUrlOk = /^https?:\/\/.+/i.test(imageUrlTrimmed);
  const fileImageOk = imageFile != null;
  const imageReady = imageMode === 'file' ? fileImageOk : imageUrlOk;

  const nameTrim = name.trim();
  /** Strip $ for Bags API; preview shows $ prefix automatically */
  const symbolTrim = useMemo(() => symbol.replace(/\$/g, '').trim(), [symbol]);
  const descriptionTrim = description.trim();
  const tickerDisplay = symbolTrim.length > 0 ? `$${symbolTrim}` : '$TICKER';

  const launchFormValid =
    nameTrim.length >= 1 &&
    nameTrim.length <= MAX_BAGS_TOKEN_NAME_LEN &&
    symbolTrim.length >= 1 &&
    symbolTrim.length <= MAX_BAGS_TOKEN_SYMBOL_LEN &&
    descriptionTrim.length >= 1 &&
    descriptionTrim.length <= MAX_BAGS_TOKEN_DESCRIPTION_LEN &&
    imageReady;

  const nameErrorText =
    submitAttempted && nameTrim.length === 0
      ? 'Name is required'
      : submitAttempted && nameTrim.length > MAX_BAGS_TOKEN_NAME_LEN
        ? `Max ${MAX_BAGS_TOKEN_NAME_LEN} characters`
        : undefined;
  const symbolErrorText =
    submitAttempted && symbolTrim.length === 0
      ? 'Symbol is required'
      : submitAttempted && symbolTrim.length > MAX_BAGS_TOKEN_SYMBOL_LEN
        ? `Max ${MAX_BAGS_TOKEN_SYMBOL_LEN} characters`
        : undefined;
  const descriptionErrorText =
    submitAttempted && descriptionTrim.length === 0
      ? 'Description is required'
      : submitAttempted && descriptionTrim.length > MAX_BAGS_TOKEN_DESCRIPTION_LEN
        ? `Max ${MAX_BAGS_TOKEN_DESCRIPTION_LEN} characters`
        : undefined;

  const previewImageSource =
    imageMode === 'file' && imageUri
      ? { uri: imageUri }
      : imageMode === 'url' && imageUrlOk
        ? { uri: imageUrlTrimmed }
        : null;

  const walletOk = !!state.walletPublicKey;
  /** Bags launch is mainnet-only; devnet blocks send (tap button shows alert). */
  const isDevnet = state.network === 'devnet';
  const solBalanceSufficient =
    walletLamports === null || walletLamports >= requiredLamportsForLaunch;
  const solBalanceKnownInsufficient =
    walletLamports !== null && walletLamports < requiredLamportsForLaunch;
  const canLaunch =
    walletOk &&
    launchFormValid &&
    !busy &&
    !isDevnet &&
    !balanceLoading &&
    solBalanceSufficient;

  const onLaunch = useCallback(async () => {
    if (!state.walletPublicKey) return;
    if (isDevnet) {
      Alert.alert(
        'Switch to mainnet for Bags',
        'Bags token launches use Solana mainnet (same as the Bags site and your partner config). On devnet, use Bulk Blast only to practice airdrops with free devnet SOL — no real money.',
      );
      return;
    }
    if (walletLamports !== null && walletLamports < requiredLamportsForLaunch) {
      const buyPart =
        solUi > 0
          ? ` plus ${solUi} SOL for your initial buy`
          : ' (no initial buy selected)';
      Alert.alert(
        'Not enough SOL in this wallet',
        `We estimate you need about ${requiredSolDisplay} SOL in this wallet: ~${MIN_LAUNCH_BUFFER_SOL} SOL for fees/rent (fee-share setup + launch)${buyPart}. ` +
          `Fund your BulkBlast in-app wallet, tap Refresh under the button, then try again. ` +
          `After a successful launch, tap BLAST NOW to open Bulk Blast and send your new token to many wallets.`,
      );
      return;
    }
    if (imageMode === 'file' && !imageFile) return;
    if (imageMode === 'url' && !imageUrlOk) return;

    if (!launchFormValid) {
      setSubmitAttempted(true);
      Alert.alert('Check form', 'Fill in all required fields within the character limits.');
      return;
    }

    const n = parseFloat(initialBuySol.replace(',', '.'));
    const sol = Number.isNaN(n) ? 0 : Math.max(0, Math.min(n, MAX_INITIAL_BUY_SOL_SANITY));
    if (sol < MIN_INITIAL_BUY_SOL) {
      Alert.alert(
        'Initial buy too low',
        `Set at least ${MIN_INITIAL_BUY_SOL} SOL so the creator wallet receives tokens at launch.`,
      );
      return;
    }
    const lamports = Math.floor(sol * LAMPORTS_PER_SOL);
    if (!Number.isSafeInteger(lamports)) {
      Alert.alert('Amount too large', 'Initial buy is too large to process. Enter a smaller SOL amount.');
      return;
    }

    setBusy(true);
    setProgressStep('metadata');

    try {
      const pk = new PublicKey(state.walletPublicKey);

      const result = await launchTokenWithPartner({
        ...(imageMode === 'file'
          ? { imageFile: imageFile! }
          : { imageUrl: imageUrlTrimmed }),
        name: name.trim(),
        symbol: symbolTrim,
        description: description.trim(),
        socialLinks: {
          twitter: twitter.trim() || undefined,
          telegram: telegram.trim() || undefined,
          website: website.trim() || undefined,
        },
        initialBuyLamports: lamports,
        publicKey: pk,
        onProgress: (step) => setProgressStep(step),
      });

      const vtx = deserializeLaunchTransaction(result.serializedTransaction);
      const signed = (await signTransaction(vtx)) as typeof vtx;

      const conn = getConnection();
      const raw = signed.serialize();
      const signature = await conn.sendRawTransaction(raw, {
        skipPreflight: false,
        maxRetries: 3,
      });

      void trackBulkBlastBagsLaunch({
        mint: result.tokenMint,
        symbol: symbolTrim,
        wallet: state.walletPublicKey,
        txSignature: signature,
        solanaMobileSeekerEligible: !!(state.solanaMobileOwner && state.seekerDiscountEnabled),
      });
      await StorageService.saveBagsLaunch({
        id: `${Date.now()}-${result.tokenMint}`,
        createdAt: Date.now(),
        walletPublicKey: state.walletPublicKey,
        tokenMint: result.tokenMint,
        tokenSymbol: symbolTrim,
        signature,
      });

      navigation.navigate('LaunchBlastSuccess', {
        tokenMint: result.tokenMint,
        tokenSymbol: symbolTrim,
        signature,
      });
    } catch (e) {
      showLaunchErrorAlert(e);
    } finally {
      setBusy(false);
      setProgressStep(null);
    }
  }, [
    navigation,
    state.walletPublicKey,
    imageMode,
    imageFile,
    imageUrlOk,
    imageUrlTrimmed,
    initialBuySol,
    launchFormValid,
    symbolTrim,
    state.solanaMobileOwner,
    state.seekerDiscountEnabled,
    name,
    symbol,
    description,
    twitter,
    telegram,
    website,
    isDevnet,
    walletLamports,
    requiredLamportsForLaunch,
    requiredSolDisplay,
    solUi,
  ]);

  return (
    <Screen scroll contentStyle={{ paddingBottom: spacing[12] }}>
      {!walletOk ? (
        <Card>
          <Text style={[styles.hint, { color: colors.warning ?? colors.textSecondary }]}>
            Finish wallet setup from the Welcome flow to launch.
          </Text>
        </Card>
      ) : null}

      <View style={styles.createTokenHeaderRow}>
        <Animated.View
          style={[
            styles.createTokenWrap,
            { opacity: createGlowOpacity, transform: [{ scale: createGlowScale }] },
          ]}
        >
          <Text style={styles.createTokenIcon}>✨</Text>
          <Text style={styles.createTokenText}>CREATE TOKEN</Text>
        </Animated.View>
        <Pressable
          onPress={() => navigation.navigate('LaunchBlastHistory')}
          style={styles.historyBtn}
          accessibilityRole="button"
          accessibilityLabel="Token launch history"
        >
          <Text style={{ fontSize: 16, color: colors.text }}>🕘</Text>
        </Pressable>
      </View>

      <Card>
        <Text style={styles.sectionHeader}>Token image</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[3] }}>
          <Chip
            label="Upload file"
            selected={imageMode === 'file'}
            onPress={() => {
              setImageMode('file');
              setImageUrl('');
            }}
          />
          <Chip
            label="Image URL"
            selected={imageMode === 'url'}
            onPress={() => {
              setImageMode('url');
              clearImage();
            }}
          />
        </View>

        {imageMode === 'file' ? (
          <>
            <Pressable onPress={pickImage} style={styles.imageBox}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.imagePreview} resizeMode="cover" />
              ) : (
                <Text style={{ color: colors.textSecondary, fontWeight: typography.weight.medium }}>
                  Tap to choose image
                </Text>
              )}
            </Pressable>
            {imageUri ? (
              <Button title="Remove image" onPress={clearImage} variant="ghost" style={{ marginTop: spacing[3] }} />
            ) : null}
          </>
        ) : (
          <>
            <Input
              label="Image URL (https)"
              value={imageUrl}
              onChangeText={(text) => {
                setImageUrl(text);
                setImageUrlPreviewFailed(false);
              }}
              placeholder="https://…/logo.png"
              autoCapitalize="none"
            />
            {imageUrlOk ? (
              <View style={[styles.imageBox, { marginTop: spacing[3] }]}>
                <Image
                  source={{ uri: imageUrlTrimmed }}
                  style={styles.imagePreview}
                  resizeMode="cover"
                  onError={() => setImageUrlPreviewFailed(true)}
                  onLoad={() => setImageUrlPreviewFailed(false)}
                />
              </View>
            ) : null}
            {imageUrlOk && imageUrlPreviewFailed ? (
              <Text style={styles.imagePreviewError}>
                Could not preview this URL. Use a direct image link (for example ending in .png, .jpg, .jpeg, .gif, or .webp), not a webpage URL.
              </Text>
            ) : null}
            {imageUrlTrimmed.length > 0 ? (
              <Button title="Clear URL" onPress={clearImageUrl} variant="ghost" style={{ marginTop: spacing[3] }} />
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <Text style={styles.sectionHeader}>Token details</Text>
        <Input
          label={`Name (max ${MAX_BAGS_TOKEN_NAME_LEN} chars)`}
          value={name}
          onChangeText={(t) => setName(t.slice(0, MAX_BAGS_TOKEN_NAME_LEN))}
          placeholder="Token Name"
          errorText={nameErrorText}
          maxLength={MAX_BAGS_TOKEN_NAME_LEN}
        />
        <Text style={styles.charCount}>
          {name.length}/{MAX_BAGS_TOKEN_NAME_LEN}
        </Text>
        <Input
          label={`Ticker (max ${MAX_BAGS_TOKEN_SYMBOL_LEN} chars, $ added in preview)`}
          value={symbol}
          onChangeText={(t) =>
            setSymbol(t.replace(/\$/g, '').slice(0, MAX_BAGS_TOKEN_SYMBOL_LEN))
          }
          placeholder="TICKER"
          style={{ marginTop: spacing[3] }}
          errorText={symbolErrorText}
          maxLength={MAX_BAGS_TOKEN_SYMBOL_LEN}
        />
        <Text style={styles.charCount}>
          {symbol.length}/{MAX_BAGS_TOKEN_SYMBOL_LEN}
        </Text>
        <Input
          label={`Description (required, max ${MAX_BAGS_TOKEN_DESCRIPTION_LEN} chars)`}
          value={description}
          onChangeText={(t) => setDescription(t.slice(0, MAX_BAGS_TOKEN_DESCRIPTION_LEN))}
          placeholder="What is this token about?"
          multiline
          numberOfLines={4}
          inputStyle={{ minHeight: 100, textAlignVertical: 'top' }}
          style={{ marginTop: spacing[3] }}
          errorText={descriptionErrorText}
          maxLength={MAX_BAGS_TOKEN_DESCRIPTION_LEN}
        />
        <Text style={styles.charCount}>
          {description.length}/{MAX_BAGS_TOKEN_DESCRIPTION_LEN}
        </Text>
      </Card>

      <Card>
        <Text style={styles.sectionHeader}>Social links (optional)</Text>
        <Input label="Twitter / X" value={twitter} onChangeText={setTwitter} placeholder="https://x.com/..." />
        <Input label="Telegram" value={telegram} onChangeText={setTelegram} placeholder="https://t.me/..." style={{ marginTop: spacing[3] }} />
        <Input label="Website" value={website} onChangeText={setWebsite} placeholder="https://..." style={{ marginTop: spacing[3] }} />
      </Card>

      <Card>
        <Text style={styles.sectionHeader}>Initial buy (SOL)</Text>
        <Text style={styles.hint}>
          Creator receives launch tokens via initial buy math on Bags/Meteora. Minimum enforced here is {MIN_INITIAL_BUY_SOL} SOL.
        </Text>
        <Input
          label="Amount (SOL)"
          value={initialBuySol}
          onChangeText={(t) => {
            const cleaned = t.replace(/[^0-9.,]/g, '');
            setInitialBuySol(cleaned);
          }}
          placeholder="0.01"
          keyboardType="decimal-pad"
          style={{ marginTop: spacing[2] }}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3] }}>
          {SOL_PRESETS.map((p) => {
            const presetVal = parseFloat(p);
            const matchesAmount =
              !Number.isNaN(presetVal) && Math.abs(solUi - presetVal) < 1e-8;
            return (
              <Chip
                key={p}
                label={`${p} SOL`}
                selected={initialBuySol === p || matchesAmount}
                onPress={() => setInitialBuySol(p)}
              />
            );
          })}
        </View>
      </Card>

      {launchFormValid && !busy ? (
        <Card style={styles.previewCard}>
          <Text style={styles.sectionHeader}>Preview</Text>
          <Text style={[styles.hint, { marginBottom: spacing[3] }]}>How your token card will look on Bags</Text>
          <View style={{ flexDirection: 'row', gap: spacing[3], alignItems: 'center' }}>
            {previewImageSource ? (
              <Image source={previewImageSource} style={styles.previewImage} resizeMode="cover" />
            ) : (
              <View style={[styles.previewImage, { alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ fontSize: 28 }}>🪙</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.previewName} numberOfLines={2}>
                {nameTrim || 'Token name'}
              </Text>
              <Text style={styles.previewSymbol}>{tickerDisplay}</Text>
              <Text style={styles.previewDesc} numberOfLines={3}>
                {descriptionTrim || 'Description'}
              </Text>
            </View>
          </View>
          <Text style={[styles.hint, { marginTop: spacing[3] }]}>
            Initial buy:{' '}
            {solUi >= 100
              ? solUi.toLocaleString('en-US', { maximumFractionDigits: 6 })
              : solUi.toFixed(6).replace(/\.?0+$/, '') || '0'}{' '}
            SOL
          </Text>
        </Card>
      ) : null}

      {busy ? (
        <Card>
          <Text style={styles.sectionHeader}>Preparing launch</Text>
          {STEP_META.map(({ key, label }) => {
            const idx = STEP_META.findIndex((s) => s.key === key);
            const currentIdx = progressStep ? STEP_META.findIndex((s) => s.key === progressStep) : -1;
            const done = currentIdx > idx;
            const active = progressStep === key;

            return (
              <View key={key} style={styles.stepRow}>
                {done ? (
                  <Text style={{ color: colors.success, fontSize: 18 }}>✓</Text>
                ) : active ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={{ color: colors.textSecondary, fontSize: 16 }}>○</Text>
                )}
                <Text style={[styles.stepLabel, !active && !done && styles.stepLabelMuted]}>{label}</Text>
              </View>
            );
          })}
        </Card>
      ) : null}

      <Button
        title="LAUNCH & BLAST"
        onPress={onLaunch}
        disabled={!canLaunch}
        loading={busy}
        variant="primary"
        style={{ minHeight: 56, marginTop: spacing[2] }}
        textStyle={{ fontSize: typography.fontSize.body, fontWeight: typography.weight.bold, letterSpacing: 0.5 }}
      />

      {walletOk && !isDevnet ? (
        <View style={styles.solBalanceRow}>
          {balanceLoading ? (
            <Text style={[styles.hint, { textAlign: 'center' }]}>Checking wallet balance…</Text>
          ) : walletLamports !== null ? (
            <Text style={[styles.hint, { textAlign: 'center' }]}>
              Wallet balance:{' '}
              <Text style={{ color: colors.text, fontWeight: typography.weight.semibold }}>
                {(walletLamports / LAMPORTS_PER_SOL).toFixed(4).replace(/\.?0+$/, '') || '0'} SOL
              </Text>
              {' · '}
              <Text
                onPress={() => void refreshLaunchWalletBalance()}
                style={{ color: colors.primary, fontWeight: typography.weight.semibold }}
              >
                Refresh
              </Text>
            </Text>
          ) : (
            <Text style={[styles.hint, { textAlign: 'center' }]}>
              Couldn’t load balance.{' '}
              <Text
                onPress={() => void refreshLaunchWalletBalance()}
                style={{ color: colors.primary, fontWeight: typography.weight.semibold }}
              >
                Retry
              </Text>
            </Text>
          )}
        </View>
      ) : null}

      {walletOk && !isDevnet && solBalanceKnownInsufficient ? (
        <View style={styles.solWarningCard}>
          <Text style={styles.solWarningTitle}>Add SOL before launching</Text>
          <Text style={styles.solWarningBody}>
            Your in-app wallet likely needs about {requiredSolDisplay} SOL for this launch: ~{MIN_LAUNCH_BUFFER_SOL} SOL
            for on-chain fees and rent (fee-share setup + launch)
            {solUi > 0 ? `, plus ${solUi} SOL for your initial buy` : ''}. Bags may require a bit more if network fees
            spike—extra buffer helps. Failed attempts still cost small transaction fees.
            {'\n\n'}
            After launch succeeds, tap <Text style={{ fontWeight: typography.weight.bold, color: colors.text }}>BLAST NOW</Text> on the
            next screen to open Bulk Blast with your new mint prefilled so you can bulk-send the token.
          </Text>
        </View>
      ) : null}

      {isDevnet && walletOk ? (
        <Text style={[styles.hint, { textAlign: 'center', color: colors.warningText }]}>
          Launch needs mainnet — turn on “Use Mainnet” in Settings (uses real SOL).
        </Text>
      ) : null}

      <Text style={[styles.royaltiesNote, { marginTop: spacing[4] }]}>
        Create and Launch tokens with{' '}
        <Text style={styles.royaltiesEmphasis}>BULKBLAST</Text> via a single click.
      </Text>

      <View style={styles.networkFooter}>
        <Animated.View
          style={[
            styles.networkDot,
            {
              backgroundColor: isDevnet ? colors.warning : colors.success,
              opacity: blinkOpacity,
            },
          ]}
        />
        <Text style={styles.networkLabel}>
          {isDevnet ? 'Devnet on' : 'Mainnet on'}
        </Text>
      </View>

      <Text style={styles.bagsPoweredBy}>Powered by BAGS</Text>
    </Screen>
  );
}
