import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, Switch, Alert, TouchableOpacity, ActivityIndicator, Image, Modal, ScrollView, AppState, AppStateStatus, Platform } from 'react-native';
import { useIsFocused, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { readAsStringAsync } from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';

import type { CreateDropStackParamList } from '../../navigation/types';
import { Button, Card, Chip, Input } from '../../components/ui';
import { StickyAppHeader } from '../../components/ui/StickyAppHeader';
import { useApp } from '../../state/context';
import type { Recipient } from '../../types/recipient';
import { buildRecipientList, parseCsv, parseTextData, parseXlsx } from '../../utils/recipients';
import { EditRecipientModal } from '../../components/modals/EditRecipientModal';
import { pickRandomRecipients } from '../../utils/giveaway';
import { Connection } from '@solana/web3.js';
import { getWalletPortfolio, type WalletPortfolio, type TokenBalance, getSplTokenInfo, getSplBalance, getSolBalance, getAllTokens, sendSol, sendSplToken } from '../../services/SolanaService';
import { spacing, typography, useTheme, type Colors } from '../../theme';
import type { SelectedAsset, AssetBalance } from '../../types/asset';
import { PortfolioService, PortfolioSnapshot, PortfolioAsset } from '../../services/PortfolioService';
import { AssetMetadataService } from '../../services/AssetMetadataService';
import { StorageService } from '../../services/StorageService';
import type { DropReceipt, BatchReceipt } from '../../types/receipt';
import { getNetwork } from '../../services/SolanaService';
import { NftDetectionService } from '../../services/NftDetectionService';
import { DetectedNftAsset, DetectedNftItem } from '../../types/nft';
import { NftTransferService } from '../../services/NftTransferService';
import { Logger } from '../../utils/Logger';
import { sanitizeError } from '../../utils/errorUtils';

// Legacy logos map removed/reduced as we use dynamic fetching now
const GENERIC_TOKEN_ICON = 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'CreateDrop'>;
const RECIPIENTS_PAGE_SIZE = 50;

type NftTileProps = {
  item: DetectedNftItem;
  colors: Colors;
  onPress?: () => void;
};

const nftStyles = StyleSheet.create({
  nftItem: {
    width: '48%',
    borderRadius: 12,
    overflow: 'hidden',
  },
  nftPlaceholder: {
    width: '100%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#111827',
  },
  nftName: {
    fontSize: 12,
    fontWeight: typography.weight.semibold,
  },
  nftSub: {
    marginTop: 2,
    fontSize: 10,
  },
});

function NftTile({ item, colors }: NftTileProps) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string>(item.name || 'NFT');

  useEffect(() => {
    if (item.uri && item.uri.match(/\.(jpeg|jpg|gif|png)$/) != null) {
      setImageUri(item.uri);
      return;
    }
    
    // If we already have a direct image link in uri (common in some standards), use it
    // Otherwise fetch json.
    if (item.uri) {
       fetch(item.uri)
        .then((res) => res.json())
        .then((data) => {
          if (data?.image && typeof data.image === 'string') setImageUri(data.image);
        })
        .catch(() => {});
    }
  }, [item.uri]);

  return (
    <View style={[nftStyles.nftItem, { backgroundColor: colors.surface2, marginBottom: 8 }]}>
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={{ width: '100%', aspectRatio: 1 }} resizeMode="cover" />
      ) : (
        <View style={[nftStyles.nftPlaceholder, { height: 150 }]}>
          <Text style={{ fontSize: 32 }}>🖼️</Text>
        </View>
      )}
      <View style={{ padding: 8 }}>
        <Text style={[nftStyles.nftName, { color: colors.text }]} numberOfLines={1}>
          {resolvedName}
        </Text>
        <Text style={[nftStyles.nftSub, { color: colors.textSecondary }]} numberOfLines={1}>
          {shortAddress(item.mint)}
        </Text>
      </View>
    </View>
  );
}

import { validateAmount, computeTotalToSend, validateRecipientsAmounts } from '../../utils/amounts';

export function CreateDrop({ navigation }: Props) {
  const route = useRoute<RouteProp<CreateDropStackParamList, 'CreateDrop'>>();
  const { state, dispatch } = useApp();
  const { colors } = useTheme();
  const isFocused = useIsFocused();
  const [mode, setMode] = useState<'manual' | 'csv'>('manual');
  const [manualText, setManualText] = useState('');
  const [singleAddress, setSingleAddress] = useState('');
  const [singleAmount, setSingleAmount] = useState('');
  const [editingRecipient, setEditingRecipient] = useState<Recipient | null>(null);
  const [recipientPage, setRecipientPage] = useState(0);

  const [winnerCountInput, setWinnerCountInput] = useState(state.giveawayConfig.winnerCount.toString());
  const [bannerError, setBannerError] = useState<string | undefined>();
  const [bagsBlastBannerVisible, setBagsBlastBannerVisible] = useState(false);
  const bulkPrefillHandledKeyRef = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<'wallet' | 'bulk_send'>('wallet');
  
  // Updated State for Portfolio
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [refreshingPortfolio, setRefreshingPortfolio] = useState(false); // Silent refresh
  const isFetchingPortfolio = useRef(false);
  const appState = useRef(AppState.currentState);
  
  // Use DetectedNftAsset instead of local state management for meta
  const [nftGroups, setNftGroups] = useState<DetectedNftAsset[]>([]);
  const [activeNftGroup, setActiveNftGroup] = useState<DetectedNftAsset | null>(null);
  const [nftCollectionModalVisible, setNftCollectionModalVisible] = useState(false);
  
  // Wallet View State
  const [walletSubTab, setWalletSubTab] = useState<'tokens' | 'nfts'>('tokens');
  const [showAllTokens, setShowAllTokens] = useState(false);
  const [showAllNfts, setShowAllNfts] = useState(false);
  const [sendModalVisible, setSendModalVisible] = useState(false);
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendToken, setSendToken] = useState<PortfolioAsset | null>(null);
  const [sending, setSending] = useState(false);

  // Asset Selection State
  const [assetTab, setAssetTab] = useState<'SOL' | 'SPL' | 'NFT'>('SOL');
  const [scanAddress, setScanAddress] = useState('');
  const [externalPortfolio, setExternalPortfolio] = useState<PortfolioSnapshot | null>(null);
  const [loadingScan, setLoadingScan] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  
  // SOL State
  const [solBalance, setSolBalance] = useState<AssetBalance | null>(null);
  const [loadingSol, setLoadingSol] = useState(false);

  // SPL State
  const [mintAddress, setMintAddress] = useState('');
  const [symbol, setSymbol] = useState('');
  const [tokenInfo, setTokenInfo] = useState<{ decimals: number; mint: string } | null>(null);
  const [splBalance, setSplBalance] = useState<AssetBalance | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // NFT State (For Bulk Send Selection)
  // const [loadingNfts, setLoadingNfts] = useState(false); // Removed legacy
  const [selectedNftGroup, setSelectedNftGroup] = useState<DetectedNftAsset | null>(null);

  // Removed duplicate loadPortfolio definition


  useEffect(() => {
    // When switching tabs, reset relevant state
    if (assetTab === 'SOL') {
      setMintAddress('');
      setTokenInfo(null);
      setSplBalance(null);
      setSymbol('');
    } else if (assetTab === 'SPL') {
      // Auto-load tokens if wallet is connected and not loaded yet
      if (state.walletPublicKey && !portfolio && !loadingPortfolio) {
        loadPortfolio();
      }
    } else if (assetTab === 'NFT') {
      setMintAddress('');
      setTokenInfo(null);
      setSplBalance(null);
      setSymbol('');
      if (state.walletPublicKey) {
        // NftService.getGroupedNfts is called in loadPortfolio already, 
        // but we can trigger a refresh if needed or ensure groups are set.
        // Assuming loadPortfolio handles it.
      }
    }
  }, [assetTab]);

  // Removed legacy onLoadNfts which caused ReferenceError
  
  function onSelectNft(mint: string) {
    setMintAddress(mint);
    // Fetch info to confirm decimals=0 and get balance
    onFetchToken(mint);
  }

  const isWalletReady = !!state.walletPublicKey && 
    (state.walletMode !== 'built_in' || state.builtInWalletStatus === 'unlocked');

  // Fetch SOL Balance when tab is SOL
  useEffect(() => {
    if (isWalletReady && assetTab === 'SOL' && activeTab === 'bulk_send') {
      fetchSolBalance();
    }
  }, [isWalletReady, assetTab, activeTab, state.walletPublicKey]);

  async function fetchSolBalance() {
    if (!state.walletPublicKey) return null;
    setLoadingSol(true);
    try {
      const bal = await getSolBalance(state.walletPublicKey);
      const assetBal = { amountUi: bal.ui, raw: bal.lamports.toString() };
      setSolBalance(assetBal);
      return assetBal;
    } catch (e: any) {
      Logger.error('Failed to fetch SOL balance: ' + e.message);
      return null;
    } finally {
      setLoadingSol(false);
    }
  }

  // Fetch Portfolio Logic — shows cached data instantly, then refreshes in background.
  const loadPortfolio = async (silent = false) => {
    if (!state.walletPublicKey) return;

    if (isFetchingPortfolio.current) return;
    isFetchingPortfolio.current = true;

    // Show cached snapshot immediately so the user sees balances right away.
    if (!portfolio) {
      try {
        const cached = await PortfolioService.loadCachedSnapshot(state.walletPublicKey);
        if (cached) {
          setPortfolio(cached);
          silent = true; // Already have something to show — no spinner needed.
        }
      } catch {}
    }

    if (!silent) setLoadingPortfolio(true);
    else setRefreshingPortfolio(true);

    try {
      const snapshot = await PortfolioService.getPortfolioSnapshot(state.walletPublicKey);
      setPortfolio(snapshot);

      if (snapshot.rawNfts && snapshot.rawNfts.length > 0) {
        const connection = new Connection('https://api.mainnet-beta.solana.com');
        const mints = snapshot.rawNfts.map((n) => n.mint);
        NftDetectionService.detectAndGroupNfts(connection, mints, state.walletPublicKey)
          .then((groups) => setNftGroups(groups))
          .catch((e) => Logger.warn('NFT grouping failed', e));
      } else {
        setNftGroups([]);
      }
    } catch (e) {
      Logger.error('Failed to load wallet portfolio', e);
      if (!silent) Alert.alert('Error', 'Failed to load wallet portfolio');
    } finally {
      isFetchingPortfolio.current = false;
      setLoadingPortfolio(false);
      setRefreshingPortfolio(false);
    }
  };

  // Fetch Portfolio when tab is Wallet
  useEffect(() => {
    if (isWalletReady && activeTab === 'wallet') {
      // Initial load: full spinner if no data
      const silent = !!portfolio;
      loadPortfolio(silent);
    }
  }, [isWalletReady, activeTab, state.walletPublicKey, state.feeTokenMint]);

  // AppState Listener (Background -> Active)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
         // App has come to the foreground
         if (isWalletReady && activeTab === 'wallet') {
            Logger.info('App resumed: Refreshing portfolio...');
            loadPortfolio(true); // Silent refresh
         }
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [isWalletReady, activeTab]);

  // Screen Focus Listener (Returning from Swap/Settings)
  useEffect(() => {
    if (isFocused && isWalletReady && activeTab === 'wallet') {
       // Silent refresh on focus if we already have data
       // Or full load if we don't
       const silent = !!portfolio;
       loadPortfolio(silent);
    }
  }, [isFocused, isWalletReady, activeTab]);

  function onSwap() {
    navigation.navigate('SwapModal');
  }

  const onOpenSend = (token: PortfolioAsset) => {
      setSendToken(token);
      setSendRecipient('');
      setSendAmount('');
      setSendModalVisible(true);
  };

  const onSendToken = async () => {
      if (!sendToken || !sendRecipient || !sendAmount || !state.walletPublicKey || !state.walletMode) return;
      
      setSending(true);
      try {
          const startTime = Date.now();
          let sig = '';
          if (sendToken.kind === 'SOL') {
             sig = await sendSol({
                 to: sendRecipient,
                 amountUi: sendAmount,
                 from: state.walletPublicKey,
                 walletMode: state.walletMode
             });
          } else {
             sig = await sendSplToken({
                 to: sendRecipient,
                 mint: sendToken.mint,
                 amountUi: sendAmount,
                 decimals: sendToken.decimals,
                 from: state.walletPublicKey,
                 walletMode: state.walletMode
             });
          }

          // Save Receipt
          const receiptId = Crypto.randomUUID();
          const batchReceipt: BatchReceipt = {
            batchIndex: 0,
            ok: true,
            signature: sig,
            startedAt: startTime,
            finishedAt: Date.now(),
            recipientIds: ['single-send-id'],
          };

          const dropReceipt: DropReceipt = {
            id: receiptId,
            createdAt: Date.now(),
            network: getNetwork(),
            walletPublicKey: state.walletPublicKey,
            asset: sendToken.kind === 'SOL' 
              ? { kind: 'SOL' } 
              : { 
                  kind: 'SPL', 
                  mint: sendToken.mint, 
                  symbol: sendToken.symbol, 
                  decimals: sendToken.decimals 
                },
            recipientCount: 1,
            validRecipientCount: 1,
            totalAmountUi: sendAmount,
            recipients: [{ id: 'single-send-id', address: sendRecipient, amount: sendAmount }],
            fee: {
              feeMint: state.feeTokenMint,
              feeTokens: '0', // No fee for single manual sends in this context usually? Or minimal.
              discounted: false,
            },
            batchSize: 1,
            batches: [batchReceipt],
            status: 'success',
          };

          await StorageService.saveReceipt(dropReceipt);

          Alert.alert('Success', `Sent! Signature: ${sig.slice(0, 8)}...`);
          setSendModalVisible(false);
          // Refresh portfolio
          loadPortfolio(true); // Silent refresh
      } catch (e: any) {
          Alert.alert('Error', sanitizeError(e));
      } finally {
          setSending(false);
      }
  };

  async function onScanWallet(overrideAddress?: string) {
    const target = overrideAddress || scanAddress;
    if (!target) return;
    
    if (overrideAddress) setScanAddress(overrideAddress);

    setLoadingScan(true);
    setScanError(null);
    setExternalPortfolio(null);

    try {
       // Basic address validation
       if (target.length < 32) throw new Error('Invalid address length');

       // Use PortfolioService to get the snapshot for the external wallet
       const snapshot = await PortfolioService.getPortfolioSnapshot(target);
       setExternalPortfolio(snapshot);

    } catch (e: any) {
      setScanError(sanitizeError(e));
    } finally {
      setLoadingScan(false);
    }
  }

  function onSelectScannedToken(token: PortfolioAsset) {
    setAssetTab('SPL');
    setMintAddress(token.mint);
    setSymbol(token.symbol);
    // Set info directly from PortfolioAsset
    setTokenInfo({ decimals: token.decimals, mint: token.mint });
    setSplBalance({ amountUi: token.balanceUi, raw: '0' }); // Placeholder raw
    // Still fetch fresh details to ensure up-to-date balance for sending
    // But UI updates instantly now
  }

  function onSelectScannedSol(solUi: string) {
    setAssetTab('SOL');
    // We might need to fetch raw balance if we want to use it
    // But since we are scanning *another* wallet potentially, we can't send from it unless it's ours.
    // Wait, "Scan Wallet" implies scanning a SOURCE wallet?
    // If the user scans a random wallet, they can't send from it.
    // The user probably wants to scan *their own* wallet easily or scan a "Source" wallet?
    // If "Scan Wallet" is just a helper to find a token MINT, then we just need the Mint Address.
    // Yes, "select them for Bulk Sender" -> select the token MINT.
    // The actual sending must be done from the connected wallet.
    // So fetching balance should be done for the *connected* wallet, not the scanned wallet.
    // Correct.
    // So when selecting from scan, we take the MINT, and then fetch balance for CONNECTED wallet.
    
    // For SOL, it's just SOL.
    if (state.walletPublicKey) {
        fetchSolBalance();
    }
  }

  async function onFetchToken(mintToFetch?: string) {
    const mint = mintToFetch || mintAddress;
    if (!mint) return;
    setTokenError(null);
    setLoadingToken(true);
    setTokenInfo(null);
    setSplBalance(null);

    try {
      const info = await getSplTokenInfo(mint);
      setTokenInfo(info);

      if (state.walletPublicKey) {
        const balUi = await getSplBalance(state.walletPublicKey, mint);
        setSplBalance({ amountUi: balUi, raw: '0' }); 
      }
    } catch (e: any) {
      setTokenError(sanitizeError(e));
    } finally {
      setLoadingToken(false);
    }
  }

  /**
   * Bulk Send: optional `preFilledMint` / `preFilledSymbol` from Launch & Blast.
   * We pre-select the mint but do not auto-insert recipients.
   */
  useEffect(() => {
    const mint = route.params?.preFilledMint?.trim();
    const launchBlastFreeFee = route.params?.launchBlastFreeFee === true;
    if (!mint) {
      bulkPrefillHandledKeyRef.current = null;
      if (launchBlastFreeFee) {
        dispatch({ type: 'promo/armLaunchBlastFreeFee' });
        navigation.setParams({ launchBlastFreeFee: undefined });
      }
      return;
    }
    if (!state.walletPublicKey) return;

    const sym = (route.params?.preFilledSymbol ?? '').trim();
    const showBanner = route.params?.bagsBlastBanner !== false;

    const key = `${mint}|${sym}|${state.walletPublicKey}`;
    if (bulkPrefillHandledKeyRef.current === key) return;
    bulkPrefillHandledKeyRef.current = key;

    setActiveTab('bulk_send');
    setAssetTab('SPL');
    setMintAddress(mint);
    setSymbol(sym);
    void onFetchToken(mint);

    dispatch({ type: 'recipients/clear' });
    setRecipientPage(0);
    setManualText('address,amount\n');

    if (showBanner) {
      setBagsBlastBannerVisible(true);
    }
    if (launchBlastFreeFee) {
      dispatch({ type: 'promo/armLaunchBlastFreeFee' });
    }

    navigation.setParams({
      preFilledMint: undefined,
      preFilledSymbol: undefined,
      bagsBlastBanner: undefined,
      launchBlastFreeFee: undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot prefill when route delivers params
  }, [route.params, state.walletPublicKey, dispatch, navigation]);

  useEffect(() => {
    if (!bagsBlastBannerVisible) return;
    const t = setTimeout(() => setBagsBlastBannerVisible(false), 9000);
    return () => clearTimeout(t);
  }, [bagsBlastBannerVisible]);

  // Sync local input with global state when giveaway is enabled/disabled or reset
  useEffect(() => {
    setWinnerCountInput(state.giveawayConfig.winnerCount.toString());
  }, [state.giveawayConfig.enabled, state.giveawayConfig.winnerCount]);

  useEffect(() => {
    if (activeTab === 'wallet' && state.walletPublicKey && isFocused) {
      // Use existing loadPortfolio function
      loadPortfolio();
    }
  }, [activeTab, state.walletPublicKey, state.feeTokenMint, isFocused]);

  // Reset portfolio when wallet changes
  useEffect(() => {
    setPortfolio(null);
  }, [state.walletPublicKey]);

  // Portfolio Value Calculation
  // Now handled by PortfolioService
  // const portfolioValue = useMemo(...) -> Removed

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        scrollContent: {
          paddingBottom: spacing[16],
        },
        banner: {
          backgroundColor: colors.warningBackground,
          borderColor: colors.warningBorder,
          borderWidth: 1,
          borderRadius: 12,
          padding: spacing[4],
          marginHorizontal: spacing[4],
          marginTop: spacing[4],
        },
        bannerText: {
          color: colors.warningText,
          fontSize: typography.fontSize.bodySmall,
        },
        bagsBlastBanner: {
          marginHorizontal: spacing[4],
          marginTop: spacing[2],
          marginBottom: spacing[2],
          paddingVertical: spacing[4],
          paddingHorizontal: spacing[4],
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: colors.primary,
          borderRadius: 14,
        },
        bagsBlastBannerText: {
          color: colors.text,
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
          fontWeight: typography.weight.bold,
          textAlign: 'center',
        },
        tabContainer: {
          flexDirection: 'row',
          backgroundColor: colors.surface2,
          borderRadius: 12,
          padding: 4,
          margin: spacing[4],
        },
        walletHeader: {
          alignItems: 'center',
          paddingTop: spacing[6],
          paddingBottom: spacing[6],
          marginBottom: spacing[2],
        },
        walletTotalLabel: {
          fontSize: typography.fontSize.bodySmall,
          fontWeight: typography.weight.medium,
          marginBottom: spacing[1],
          opacity: 0.6,
          color: colors.textSecondary,
        },
        walletTotalValue: {
          fontSize: 42,
          fontWeight: '800', 
          marginBottom: spacing[3],
          letterSpacing: -1,
          color: colors.text,
        },
        walletAddressRow: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surface2,
          paddingHorizontal: spacing[3],
          paddingVertical: 6,
          borderRadius: 20,
          marginBottom: spacing[6],
        },
        walletAddress: {
          fontSize: 14,
          fontWeight: '600',
          color: colors.text,
        },
        sectionHeader: {
          fontSize: 18,
          fontWeight: 'bold',
          color: colors.text,
          marginBottom: 12,
        },
        label: {
          fontSize: 14,
          fontWeight: '600',
          color: colors.text,
          marginBottom: 4,
        },
        hint: {
          fontSize: 12,
          color: colors.textSecondary,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: colors.surface2,
          padding: 12,
          borderRadius: 12,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: 'transparent',
        },
        rowMain: {
          flex: 1,
          justifyContent: 'center',
        },
        section: {
          marginBottom: 16,
        },
        list: {
          marginTop: 8,
        },
        addr: {
          fontFamily: Platform.select({ ios: 'Courier', android: 'monospace' }),
          fontSize: 14,
          fontWeight: '600',
          color: colors.text,
          marginBottom: 2,
        },
        amount: {
          fontSize: 12,
          color: colors.textSecondary,
        },
        pill: {
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 8,
          marginLeft: 12,
        },
        pillText: {
          fontSize: 10,
          fontWeight: '700',
        },
        removeBtn: {
          padding: 8,
          marginLeft: 8,
          backgroundColor: colors.background,
          borderRadius: 20,
        },
        removeText: {
          color: colors.danger,
          fontSize: 14,
          fontWeight: 'bold',
        },
        countRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 12,
        },
        multiline: {
          minHeight: 80,
          textAlignVertical: 'top',
        },
        actionBtn: {
          marginTop: 8,
        },
        btn: {
          marginTop: 16,
        },
        empty: {
          textAlign: 'center',
          color: colors.textSecondary,
          marginTop: 20,
        },
        modalOverlay: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.5)',
        },
        modalContent: {
          width: '90%',
          padding: 20,
          borderRadius: 16,
          maxHeight: '80%',
        },
        nftGrid: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        },
      }),
    [colors]
  );

  const summary = useMemo(() => {
    const total = state.recipients.length;
    const valid = state.recipients.filter((r) => r.isValid).length;
    const invalid = state.recipients.filter((r) => r.error === 'invalid_address').length;
    const duplicates = state.recipients.filter((r) => r.error === 'duplicate').length;
    return { total, valid, invalid, duplicates };
  }, [state.recipients]);

  useEffect(() => {
    if (summary.valid > 0 && bannerError) setBannerError(undefined);
  }, [bannerError, summary.valid]);

  function onAddRecipients(source: Recipient['source'], payload: string[] | Array<{ address: string; amount?: string }>) {
    const next = buildRecipientList(payload as any, source);
    dispatch({ type: 'recipients/setAll', recipients: [...state.recipients, ...next] });
  }

  function onRemoveById(id: string) {
    dispatch({ type: 'recipients/removeByIds', ids: [id] });
  }

  function onClearAll() {
    dispatch({ type: 'recipients/clear' });
  }

  function onRemoveInvalid() {
    dispatch({ type: 'recipients/cleanInvalid' });
  }

  function onRemoveDuplicates() {
    dispatch({ type: 'recipients/cleanDuplicates' });
  }

  // --- Amount Mode ---
  function onSetEqualAmount() {
    dispatch({ type: 'sendConfig/setAmountMode', mode: 'equal' });
  }

  function onSetPerRecipient() {
    dispatch({ type: 'sendConfig/setAmountMode', mode: 'perRecipient' });
  }

  // function onUpdateEqualAmount(val: string) - Replaced by inline dispatch
  // function onUpdateEqualNftCount(val: number) - Replaced by inline dispatch
  // Removed old handlers
  // function onUpdateEqualNftCount(val: number) {
  //   dispatch({ type: 'sendConfig/setEqualNftCount', count: val });
  // }
  // -------------------

  function onManualAdd() {
    const addresses = parseTextData(manualText);
    if (addresses.length === 0) return;
    onAddRecipients('manual', addresses);
    setManualText('');
  }

  function onSingleAdd() {
    if (!singleAddress) return;
    onAddRecipients('manual', [{ address: singleAddress, amount: singleAmount || undefined }]);
    setSingleAddress('');
    setSingleAmount('');
  }

  function onSaveEdit(address: string, amount: string) {
    if (!editingRecipient) return;
    dispatch({ type: 'recipients/update', id: editingRecipient.id, address, amount });
    setEditingRecipient(null);
  }

  async function onPickFile() {
    setBannerError(undefined);
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: [
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ],
    });
    if (res.canceled) return;
    const asset = res.assets?.[0];
    if (!asset?.uri) {
      setBannerError('Failed to read selected file.');
      return;
    }

    const isXlsx = asset.name.toLowerCase().endsWith('.xlsx') || asset.name.toLowerCase().endsWith('.xls');

    let rows: { address: string; amount?: string }[] = [];

    if (isXlsx) {
      try {
        const base64 = await readAsStringAsync(asset.uri, { encoding: 'base64' });
        rows = parseXlsx(base64);
      } catch (e) {
        console.error('XLSX parse error', e);
        setBannerError('Failed to parse Excel file.');
        return;
      }
    } else {
      try {
        const text = await readAsStringAsync(asset.uri);
        rows = parseCsv(text);
      } catch (e) {
        console.error('CSV parse error', e);
        setBannerError('Failed to parse CSV file.');
        return;
      }
    }

    if (rows.length === 0) {
      setBannerError('File had no rows.');
      return;
    }
    onAddRecipients('csv', rows);
  }

  async function onNext() {
    if (summary.valid === 0) {
      setBannerError('Add at least 1 valid recipient');
      Alert.alert('Missing Recipients', 'Please add at least 1 valid recipient before continuing.');
      return;
    }
    if (state.giveawayConfig.enabled && state.giveawayConfig.selectedRecipientIds.length === 0) {
      setBannerError('Select winners before continuing.');
      Alert.alert('Missing Winners', 'Please select winners for the giveaway before continuing.');
      return;
    }

    // Amount validation
    // Check if NFT mode
    const isNft = assetTab === 'NFT' || (assetTab === 'SPL' && tokenInfo?.decimals === 0);
    
    // Use correct amount source for validation
    const amountToValidate = isNft ? state.sendConfig.equalNftCount.toString() : state.sendConfig.equalAmountUi;

    // Validate amounts BEFORE setting asset/navigating
    const { valid, missingCount, invalidCount } = validateRecipientsAmounts(
      state.recipients,
      state.sendConfig.amountMode,
      amountToValidate,
      isNft
    );

    if (!valid && !state.giveawayConfig.enabled) {
      if (state.sendConfig.amountMode === 'equal') {
         Alert.alert('Invalid Amount', isNft ? 'Please enter a valid NFT count (integer).' : 'Please enter a valid amount to send.');
         return;
      } else {
         Alert.alert(
           'Invalid Amounts',
           `Some recipients have missing or invalid amounts.\nMissing: ${missingCount}\nInvalid: ${invalidCount}\n\nPlease fix them or switch to Equal Amount mode.`
         );
         return;
      }
    }

    // Asset Validation
    if (assetTab === 'SOL') {
      let balance = solBalance;
      if (!balance) {
         // Try fetching if missing
         // balance = await fetchSolBalance(); 
      }
      
      const asset: SelectedAsset = { kind: 'SOL', decimals: 9, symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112' };
      dispatch({ type: 'asset/setSelected', asset });
      if (solBalance) dispatch({ type: 'asset/setBalance', balance: solBalance });
    } else if (assetTab === 'NFT') {
      if (!selectedNftGroup) {
         setBannerError('Please select a valid NFT collection.');
         Alert.alert('Invalid Selection', 'Please select an NFT collection to send from.');
         return;
      }
      
      // Validate holdings
      const totalRequired = summary.valid * state.sendConfig.equalNftCount;
      if (selectedNftGroup.ownedCount < totalRequired) {
          Alert.alert('Insufficient NFTs', `You need ${totalRequired} items from "${selectedNftGroup.groupName}" but only own ${selectedNftGroup.ownedCount}.`);
          return;
      }

      const asset: SelectedAsset = {
        kind: 'NFT',
        mint: selectedNftGroup.groupId, // Group ID
        decimals: 0,
        symbol: selectedNftGroup.groupName, // Group Name
        groupItems: selectedNftGroup.items,
        ownedCount: selectedNftGroup.ownedCount,
        standard: selectedNftGroup.standard, // Pass standard
        tokenProgram: selectedNftGroup.tokenProgram // Pass program
      };
      dispatch({ type: 'asset/setSelected', asset });
      dispatch({ type: 'asset/setBalance', balance: { amountUi: selectedNftGroup.ownedCount.toString(), raw: selectedNftGroup.ownedCount.toString() } });
    } else {
      if (!tokenInfo) {
         setBannerError('Please select a valid SPL token.');
         Alert.alert('Invalid Token', 'Please select a valid SPL token.');
         return;
      }
      const asset: SelectedAsset = {
        kind: 'SPL',
        mint: tokenInfo.mint,
        decimals: tokenInfo.decimals,
        symbol: symbol || undefined,
      };
      dispatch({ type: 'asset/setSelected', asset });
      if (splBalance) dispatch({ type: 'asset/setBalance', balance: splBalance });
    }

    navigation.navigate('Review');
  }

  function onPickWinners() {
    try {
      const winners = pickRandomRecipients({
        recipients: state.recipients,
        count: state.giveawayConfig.winnerCount,
      });
      dispatch({
        type: 'giveaway/setSelectedRecipients',
        ids: winners.map((w) => w.id),
      });
      Alert.alert('🎉 Winners Selected!', `Successfully picked ${winners.length} random recipients.`);
    } catch (e: any) {
      Alert.alert('Giveaway Error', e.message);
    }
  }

  const selectedWinners = useMemo(() => {
    return state.recipients.filter((r) => state.giveawayConfig.selectedRecipientIds.includes(r.id));
  }, [state.recipients, state.giveawayConfig.selectedRecipientIds]);

  const recipientTotalPages = useMemo(
    () => Math.max(1, Math.ceil(state.recipients.length / RECIPIENTS_PAGE_SIZE)),
    [state.recipients.length]
  );

  const pagedRecipients = useMemo(() => {
    const start = recipientPage * RECIPIENTS_PAGE_SIZE;
    return state.recipients.slice(start, start + RECIPIENTS_PAGE_SIZE);
  }, [recipientPage, state.recipients]);

  useEffect(() => {
    const maxPageIndex = Math.max(0, recipientTotalPages - 1);
    if (recipientPage > maxPageIndex) {
      setRecipientPage(maxPageIndex);
    }
  }, [recipientPage, recipientTotalPages]);

  return (
    <View style={styles.container}>
      <StickyAppHeader 
        showLogo={false}
        center={
          <View style={{ flexDirection: 'row', backgroundColor: colors.surface2, borderRadius: 20, padding: 4 }}>
             <TouchableOpacity 
               onPress={() => setActiveTab('wallet')}
               style={{ 
                 paddingHorizontal: 20, 
                 paddingVertical: 8, 
                 borderRadius: 16,
                 backgroundColor: activeTab === 'wallet' ? colors.surface : 'transparent',
                 shadowColor: activeTab === 'wallet' ? '#000' : 'transparent',
                 shadowOpacity: 0.2,
                 shadowRadius: 4,
                 elevation: activeTab === 'wallet' ? 4 : 0
               }}
             >
                <Text style={{ fontSize: 14, fontWeight: '700', color: activeTab === 'wallet' ? colors.text : colors.textSecondary }}>Wallet</Text>
             </TouchableOpacity>
             <TouchableOpacity 
               onPress={() => setActiveTab('bulk_send')}
               style={{ 
                 paddingHorizontal: 20, 
                 paddingVertical: 8, 
                 borderRadius: 16,
                 backgroundColor: activeTab === 'bulk_send' ? colors.surface : 'transparent',
                 shadowColor: activeTab === 'bulk_send' ? '#000' : 'transparent',
                 shadowOpacity: 0.2,
                 shadowRadius: 4,
                 elevation: activeTab === 'bulk_send' ? 4 : 0
               }}
             >
                <Text style={{ fontSize: 14, fontWeight: '700', color: activeTab === 'bulk_send' ? colors.text : colors.textSecondary }}>Bulk Blast</Text>
             </TouchableOpacity>
          </View>
        }
        right={
           <TouchableOpacity onPress={() => navigation.navigate('Settings')} style={{ padding: 4 }}>
              <Text style={{ fontSize: 24 }}>⚙️</Text>
           </TouchableOpacity>
        } 
      />
      {bagsBlastBannerVisible ? (
        <View style={styles.bagsBlastBanner} accessibilityRole="alert">
          <Text style={styles.bagsBlastBannerText}>Just launched with Bags — now BLAST! 🚀</Text>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      
      {/* Tab Switcher Removed - Using Header Toggle instead */}
      {/* <View style={styles.tabContainer}> ... </View> */}

      {activeTab === 'wallet' ? (
        <>
          {state.walletPublicKey ? (
             <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
                {/* Header Section */}
                <View style={styles.walletHeader}>
                   <Text style={[styles.walletTotalLabel, { color: colors.textSecondary }]}>Total Portfolio Value</Text>
                   <Text style={[styles.walletTotalValue, { color: colors.text }]}>
                      ${(portfolio?.totalUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                   </Text>
                   
                   <TouchableOpacity onPress={() => Clipboard.setStringAsync(state.walletPublicKey!)} style={styles.walletAddressRow}>
                      <Text style={{ fontSize: 12, color: colors.textSecondary, marginRight: 6 }}>Wallet</Text>
                      <Text style={[styles.walletAddress, { color: colors.text }]}>{shortAddress(state.walletPublicKey)}</Text>
                      <Text style={{ fontSize: 12, color: colors.textSecondary, marginLeft: 4 }}>📋</Text>
                   </TouchableOpacity>
                   
                   {refreshingPortfolio && (
                     <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 4 }} />
                   )}
                   
                   {/* Action Buttons — same style as Send/Swap; Launch opens Bags flow */}
                   <View
                     style={{
                       flexDirection: 'row',
                       flexWrap: 'wrap',
                       justifyContent: 'center',
                       gap: 20,
                       rowGap: 16,
                       marginTop: 12,
                       paddingHorizontal: 8,
                     }}
                   >
                      <TouchableOpacity style={{ alignItems: 'center', gap: 8 }} onPress={() => Clipboard.setStringAsync(state.walletPublicKey!)}>
                         <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontSize: 20 }}>⬇️</Text>
                         </View>
                         <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>Receive</Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity style={{ alignItems: 'center', gap: 8 }} onPress={() => onOpenSend({ kind: 'SOL', mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9, balanceUi: '0', usdValue: 0 })}>
                         <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 }}>
                            <Text style={{ fontSize: 20, color: 'white' }}>⬆️</Text>
                         </View>
                         <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>Send</Text>
                      </TouchableOpacity>
                      
                      <TouchableOpacity style={{ alignItems: 'center', gap: 8 }} onPress={onSwap}>
                         <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ fontSize: 20 }}>🔄</Text>
                         </View>
                         <Text style={{ fontSize: 12, fontWeight: '600', color: colors.text }}>Swap</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={{ alignItems: 'center', gap: 8, minWidth: 76 }}
                        onPress={() => navigation.navigate('LaunchBlast')}
                        accessibilityRole="button"
                        accessibilityLabel="Launch and Blast"
                      >
                         <View
                           style={{
                             width: 48,
                             height: 48,
                             borderRadius: 24,
                             backgroundColor: colors.surface2,
                             alignItems: 'center',
                             justifyContent: 'center',
                             borderWidth: 1,
                             borderColor: colors.border,
                           }}
                         >
                            <Text style={{ fontSize: 20 }}>🚀</Text>
                         </View>
                         <Text
                           style={{ fontSize: 11, fontWeight: '600', color: colors.text, textAlign: 'center', maxWidth: 80 }}
                           numberOfLines={2}
                         >
                           Launch & Blast
                         </Text>
                      </TouchableOpacity>
                   </View>
                </View>

                {/* Sub Tabs - Segmented Control Style */}
                <View style={{ marginHorizontal: 16, marginBottom: 16, backgroundColor: colors.surface2, borderRadius: 12, padding: 4, flexDirection: 'row' }}>
                    <Pressable 
                        style={{ flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10, backgroundColor: walletSubTab === 'tokens' ? colors.surface : 'transparent', shadowColor: walletSubTab === 'tokens' ? '#000' : 'transparent', shadowOpacity: 0.1, shadowRadius: 2, elevation: walletSubTab === 'tokens' ? 2 : 0 }}
                        onPress={() => setWalletSubTab('tokens')}
                    >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: walletSubTab === 'tokens' ? colors.text : colors.textSecondary }}>Tokens</Text>
                    </Pressable>
                    <Pressable 
                        style={{ flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10, backgroundColor: walletSubTab === 'nfts' ? colors.surface : 'transparent', shadowColor: walletSubTab === 'nfts' ? '#000' : 'transparent', shadowOpacity: 0.1, shadowRadius: 2, elevation: walletSubTab === 'nfts' ? 2 : 0 }}
                        onPress={() => setWalletSubTab('nfts')}
                    >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: walletSubTab === 'nfts' ? colors.text : colors.textSecondary }}>Collectibles</Text>
                    </Pressable>
                </View>

                {loadingPortfolio ? (
                   <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
                ) : portfolio ? (
                   <>
                     {walletSubTab === 'tokens' ? (
                        <View style={{ paddingHorizontal: 16, paddingBottom: 40 }}>
                           {/* Render Sorted Assets (Including SOL) */}
                           {portfolio.assets.slice(0, showAllTokens ? undefined : 5).map((asset: PortfolioAsset) => (
                              <TouchableOpacity 
                                key={asset.mint} 
                                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.surface2 }} 
                                onPress={() => onOpenSend(asset)}
                              >
                                 <Image 
                                    source={{ uri: asset.iconUrl || GENERIC_TOKEN_ICON }} 
                                    style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2 }} 
                                 />
                                 <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{asset.symbol || 'Unknown'}</Text>
                                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>{asset.name || shortAddress(asset.mint)}</Text>
                                 </View>
                                 <View style={{ alignItems: 'flex-end' }}>
                                    <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
                                       ${asset.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </Text>
                                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                                       {parseFloat(asset.balanceUi).toLocaleString()} {asset.symbol}
                                    </Text>
                                 </View>
                              </TouchableOpacity>
                           ))}
                           
                           {portfolio.assets.length > 5 && (
                              <TouchableOpacity onPress={() => setShowAllTokens(!showAllTokens)} style={{ paddingVertical: 16, alignItems: 'center' }}>
                                 <Text style={{ color: colors.primary, fontWeight: '600' }}>{showAllTokens ? 'Show Less' : 'Show More Tokens'}</Text>
                              </TouchableOpacity>
                           )}
                        </View>
                     ) : (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 12, paddingBottom: 40 }}>
                            {nftGroups.length > 0 ? (
                                nftGroups.map((g) => (
                                  <TouchableOpacity
                                    key={g.groupId}
                                    style={{ width: '48%', backgroundColor: colors.surface2, borderRadius: 12, overflow: 'hidden' }}
                                    onPress={() => {
                                      setActiveNftGroup(g);
                                      setNftCollectionModalVisible(true);
                                    }}
                                  >
                                    {g.imageUri ? (
                                      <Image source={{ uri: g.imageUri }} style={{ width: '100%', aspectRatio: 1 }} resizeMode="cover" />
                                    ) : (
                                      <View style={{ width: '100%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
                                        <Text style={{ fontSize: 32 }}>🖼️</Text>
                                      </View>
                                    )}
                                    <View style={{ padding: 12 }}>
                                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }} numberOfLines={1}>
                                        {g.groupName}
                                      </Text>
                                      <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                                        {g.ownedCount} item(s)
                                      </Text>
                                    </View>
                                  </TouchableOpacity>
                                ))
                            ) : (
                                <Text style={{ textAlign: 'center', width: '100%', marginTop: 40, color: colors.textSecondary }}>No Collectibles found</Text>
                            )}

                            <Modal
                              visible={nftCollectionModalVisible}
                              transparent
                              animationType="slide"
                              onRequestClose={() => setNftCollectionModalVisible(false)}
                            >
                              <View style={styles.modalOverlay}>
                                <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}>
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Text style={[styles.sectionHeader, { color: colors.text }]}>{activeNftGroup?.groupName || 'Collection'}</Text>
                                    <Button title="Close" variant="secondary" onPress={() => setNftCollectionModalVisible(false)} />
                                  </View>

                                  <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
                                    <View style={[styles.nftGrid, { marginHorizontal: 0, paddingHorizontal: 0 }]}>
                                      {activeNftGroup?.items.map((nft) => {
                                          return (
                                            <NftTile
                                              key={nft.mint}
                                              item={nft}
                                              colors={colors}
                                            />
                                          );
                                        })}
                                    </View>
                                  </ScrollView>
                                </View>
                              </View>
                            </Modal>
                        </View>
                     )}
                   </>
                ) : (
                   <Text style={[styles.hint, { textAlign: 'center', marginTop: 20 }]}>Failed to load balances</Text>
                )}
             </ScrollView>
          ) : (
            <Card>
               <Text style={[styles.hint, { textAlign: 'center' }]}>Wallet not connected</Text>
            </Card>
          )}

          {/* Send Modal */}
          <Modal visible={sendModalVisible} transparent animationType="slide" onRequestClose={() => setSendModalVisible(false)}>
             <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}>
                   <Text style={[styles.sectionHeader, { textAlign: 'center', color: colors.text }]}>
                      Send {sendToken === 'SOL' ? 'SOL' : (sendToken as TokenBalance)?.symbol}
                   </Text>
                   
                   <Input 
                      label="Recipient Address"
                      value={sendRecipient}
                      onChangeText={setSendRecipient}
                      placeholder="Enter wallet address"
                   />
                   
                   {sendToken !== 'SOL' && (sendToken as TokenBalance)?.decimals === 0 ? (
                      // Integer input for NFTs
                      <View style={{ marginBottom: 16 }}>
                         <Text style={{ marginBottom: 8, color: colors.text }}>Quantity (Integer only)</Text>
                         <Input 
                            value={sendAmount}
                            onChangeText={(text) => setSendAmount(text.replace(/[^0-9]/g, ''))}
                            placeholder="1"
                            keyboardType="number-pad"
                         />
                         <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                            Max: {(sendToken as TokenBalance).balance}
                         </Text>
                      </View>
                   ) : (
                      <Input 
                         label="Amount"
                         value={sendAmount}
                         onChangeText={setSendAmount}
                         placeholder="0.00"
                         keyboardType="numeric"
                      />
                   )}
                   
                   <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                      <Button title="Cancel" onPress={() => setSendModalVisible(false)} variant="secondary" style={{ flex: 1 }} />
                      <Button title={sending ? "Sending..." : "Send"} onPress={onSendToken} variant="primary" style={{ flex: 1 }} disabled={sending} />
                   </View>
                </View>
             </View>
          </Modal>
        </>
      ) : (
        <>
          {bannerError ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>{bannerError}</Text>
            </View>
          ) : null}

          <Card>
            <Text style={styles.sectionHeader}>Select Asset</Text>
            <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] }}>
              <Chip label="SOL" selected={assetTab === 'SOL'} onPress={() => setAssetTab('SOL')} />
              <Chip label="SPL Token" selected={assetTab === 'SPL'} onPress={() => setAssetTab('SPL')} />
              <Chip label="NFT" selected={assetTab === 'NFT'} onPress={() => setAssetTab('NFT')} />
            </View>

            {assetTab === 'SOL' ? (
               <View style={styles.row}>
                 <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>Balance</Text>
                 <View style={{ alignItems: 'flex-end' }}>
                   {loadingSol ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Text style={{ fontSize: typography.fontSize.body, fontWeight: typography.weight.semibold, color: colors.text }}>
                      {solBalance?.amountUi ?? '0'} SOL
                    </Text>
                  )}
                  <Pressable onPress={fetchSolBalance} style={{ marginTop: 4 }}>
                    <Text style={{ color: colors.primary, fontSize: typography.fontSize.caption, fontWeight: typography.weight.semibold }}>
                      Refresh balance
                    </Text>
                  </Pressable>
                 </View>
               </View>
            ) : assetTab === 'SPL' ? (
               <View>
                 {/* Auto-load tokens from connected wallet */}
                 <View style={{ marginBottom: spacing[4] }}>
                    <Text style={[styles.label, { marginBottom: spacing[2], color: colors.text }]}>Select Token</Text>
                    
                    {loadingScan || (state.walletPublicKey && loadingPortfolio && !portfolio) ? (
                       <ActivityIndicator size="small" color={colors.primary} />
                    ) : (portfolio || externalPortfolio) ? (
                       <View style={{ maxHeight: 300, backgroundColor: colors.surface2, borderRadius: 12, padding: 8 }}>
                          <ScrollView nestedScrollEnabled style={{ maxHeight: 300 }}>
                            {(externalPortfolio || portfolio)?.assets.filter(a => a.kind === 'SPL').map(t => (
                               <TouchableOpacity 
                                 key={t.mint} 
                                 style={{
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                    padding: 12,
                                    borderBottomWidth: 1,
                                    borderBottomColor: 'rgba(255,255,255,0.05)',
                                    backgroundColor: mintAddress === t.mint ? 'rgba(255,255,255,0.1)' : 'transparent',
                                 }} 
                                 onPress={() => onSelectScannedToken(t)}
                               >
                                  <Image 
                                     source={{ uri: t.iconUrl || GENERIC_TOKEN_ICON }} 
                                     style={{ width: 32, height: 32, borderRadius: 16, marginRight: 12, backgroundColor: colors.surface2 }} 
                                  />
                                  
                                  <View style={{ flex: 1 }}>
                                     <Text style={{ color: colors.text, fontWeight: 'bold', fontSize: 16 }}>{t.symbol || 'Unknown'}</Text>
                                     <Text style={{ color: colors.textSecondary, fontSize: 10 }}>{shortAddress(t.mint)}</Text>
                                  </View>
                                  
                                  <View style={{ alignItems: 'flex-end' }}>
                                     <Text style={{ color: colors.text, fontWeight: '500' }}>{parseFloat(t.balanceUi).toLocaleString()}</Text>
                                     {t.usdValue > 0 && (
                                       <Text style={{ color: colors.textSecondary, fontSize: 10 }}>${t.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</Text>
                                     )}
                                  </View>
                               </TouchableOpacity>
                            ))}
                            {((externalPortfolio || portfolio)?.assets.filter(a => a.kind === 'SPL').length || 0) === 0 && (
                               <Text style={[styles.hint, { textAlign: 'center', padding: 20 }]}>No SPL tokens found</Text>
                            )}
                          </ScrollView>
                       </View>
                    ) : (
                       <Button 
                         title="Load My Tokens" 
                         onPress={() => state.walletPublicKey && loadPortfolio()} 
                         variant="outline"
                       />
                    )}
                 </View>

                 <Text style={[styles.hint, { textAlign: 'center', marginVertical: spacing[2] }]}>— OR —</Text>

                 {/* Manual Token Entry */}
                 <Input
                   label="Enter Mint Address Manually"
                   value={mintAddress}
                   onChangeText={setMintAddress}
                   placeholder="Token Mint Address"
                   autoCapitalize="none"
                 />
                 <Button 
                   title="Fetch Details" 
                   onPress={() => onFetchToken()} 
                   variant="secondary" 
                   style={{ marginTop: spacing[2] }}
                   disabled={loadingToken || !mintAddress}
                 />

                 {loadingToken && <ActivityIndicator style={{ marginTop: spacing[2] }} />}
                 
                 {tokenInfo && (
                   <View style={{ marginTop: spacing[4], padding: spacing[3], backgroundColor: colors.surface2, borderRadius: 8 }}>
                     <Text style={{ color: colors.text, marginBottom: spacing[1] }}>Mint: {tokenInfo.mint.slice(0, 8)}...{tokenInfo.mint.slice(-8)}</Text>
                     <Text style={{ color: colors.text, marginBottom: spacing[1] }}>Decimals: {tokenInfo.decimals}</Text>
                     <Text style={{ color: colors.text, marginBottom: spacing[1] }}>My Balance: {splBalance?.amountUi ?? '0'}</Text>
                     
                     <Input
                       label="Symbol (Optional)"
                       value={symbol}
                       onChangeText={setSymbol}
                       placeholder="e.g. USDC"
                       style={{ marginTop: spacing[2] }}
                     />
                   </View>
                 )}
                 {tokenError && <Text style={[styles.hint, { color: colors.danger, marginTop: spacing[2] }]}>{tokenError}</Text>}
               </View>
            ) : (
              <View>
                 <Text style={{ fontSize: typography.fontSize.body, fontWeight: typography.weight.medium, color: colors.text, marginBottom: spacing[2] }}>
                   Select an NFT Collection to send
                 </Text>
                 
                 {loadingPortfolio ? (
                   <ActivityIndicator color={colors.primary} />
                 ) : nftGroups.length === 0 ? (
                   <Text style={{ color: colors.textSecondary }}>No NFTs found in wallet.</Text>
                 ) : (
                   <View style={{ gap: spacing[2], maxHeight: 300 }}>
                     <ScrollView nestedScrollEnabled style={{ maxHeight: 300 }}>
                       {nftGroups.map((group) => (
                         <TouchableOpacity 
                           key={group.groupId} 
                           style={{ 
                             padding: spacing[3], 
                             backgroundColor: selectedNftGroup?.groupId === group.groupId ? colors.primary + '20' : colors.surface2,
                             borderRadius: 8,
                             borderWidth: 1,
                             borderColor: selectedNftGroup?.groupId === group.groupId ? colors.primary : 'transparent',
                             flexDirection: 'row',
                             justifyContent: 'space-between',
                             alignItems: 'center',
                             marginBottom: spacing[2]
                           }}
                           onPress={() => setSelectedNftGroup(group)}
                         >
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                              {group.imageUri ? (
                                <Image source={{ uri: group.imageUri }} style={{ width: 40, height: 40, borderRadius: 4 }} />
                              ) : (
                                <View style={{ width: 40, height: 40, backgroundColor: '#333', borderRadius: 4 }} />
                              )}
                              <View>
                                <Text style={{ color: colors.text, fontWeight: 'bold' }}>{group.groupName}</Text>
                                <Text style={{ color: colors.textSecondary, fontSize: 10 }}>{group.ownedCount} Items</Text>
                              </View>
                            </View>
                         </TouchableOpacity>
                       ))}
                     </ScrollView>
                   </View>
                 )}
                 
                 <Button 
                     title="Reload NFTs" 
                     onPress={() => loadPortfolio(false)} 
                     variant="outline" 
                     style={{ marginTop: spacing[3] }}
                   />
              </View>
            )}
          </Card>

          <Card>
            <Text style={styles.sectionHeader}>🎁 Giveaway Mode</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Enable Random Winners</Text>
              <Switch
                value={state.giveawayConfig.enabled}
                onValueChange={(val) => dispatch({ type: val ? 'giveaway/enable' : 'giveaway/disable' })}
                trackColor={{ false: colors.surface2, true: colors.primary }}
              />
            </View>

            {state.giveawayConfig.enabled && (
              <View style={styles.section}>
                <Input
                  label="Number of Winners"
                  value={winnerCountInput}
                  onChangeText={(text) => {
                    setWinnerCountInput(text);
                    const val = parseInt(text);
                    if (!isNaN(val) && val > 0) {
                      dispatch({ type: 'giveaway/setWinnerCount', count: val });
                    }
                  }}
                  onBlur={() => {
                    if (!winnerCountInput || isNaN(parseInt(winnerCountInput)) || parseInt(winnerCountInput) < 1) {
                      setWinnerCountInput(state.giveawayConfig.winnerCount.toString());
                    }
                  }}
                  keyboardType="number-pad"
                />
                <Button title={state.giveawayConfig.selectedRecipientIds.length > 0 ? "Re-roll Winners" : "Pick Winners"} onPress={onPickWinners} variant="primary" />
              </View>
            )}
          </Card>

          {state.giveawayConfig.enabled && state.giveawayConfig.selectedRecipientIds.length > 0 && (
            <Card>
              <Text style={styles.sectionHeader}>Winners Selected ({selectedWinners.length})</Text>
              <View style={styles.list}>
                {selectedWinners.map((w) => (
                  <View key={w.id} style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text style={styles.addr}>{w.address.slice(0, 8)}...{w.address.slice(-8)}</Text>
                    </View>
                    <Button
                      title="Copy"
                      onPress={() => Clipboard.setStringAsync(w.address)}
                      variant="outline"
                      style={{ paddingHorizontal: spacing[3], height: 32 }}
                      textStyle={{ fontSize: 12 }}
                    />
                  </View>
                ))}
              </View>
            </Card>
          )}

          <Card>
            <View style={{ flexDirection: 'row', gap: spacing[3], marginBottom: spacing[4] }}>
              <Chip label="Manual / Paste" selected={mode === 'manual'} onPress={() => setMode('manual')} />
              <Chip label="File Import" selected={mode === 'csv'} onPress={() => setMode('csv')} />
            </View>

            {mode === 'manual' ? (
              <View style={styles.section}>
                {/* Single Entry */}
                <View style={{ gap: spacing[3] }}>
                   <Text style={{ fontSize: typography.fontSize.body, fontWeight: typography.weight.medium, color: colors.text }}>Add Single Recipient</Text>
                   <Input
                      label="Address"
                      value={singleAddress}
                      onChangeText={setSingleAddress}
                      placeholder="Enter wallet address"
                   />
                   <Input
                      label="Amount (Optional)"
                      value={singleAmount}
                      onChangeText={setSingleAmount}
                      placeholder="0.0"
                      keyboardType="numeric"
                   />
                   <Button 
                      title="Add Recipient" 
                      onPress={onSingleAdd} 
                      variant="primary" 
                      disabled={!singleAddress} 
                      style={{ marginTop: spacing[2] }}
                   />
                </View>

                <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing[4] }} />

                {/* Bulk Entry */}
                <View style={{ gap: spacing[3] }}>
                   <Text style={{ fontSize: typography.fontSize.body, fontWeight: typography.weight.medium, color: colors.text }}>Bulk Paste</Text>
                   <Input
                     label="Paste List"
                     value={manualText}
                     onChangeText={setManualText}
                     placeholder={'One address per line\nOr: address, amount'}
                     multiline
                     numberOfLines={6}
                     inputStyle={[styles.multiline, { color: colors.text, backgroundColor: colors.surface }]}
                   />
                   <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                      <Button title="Add Batch" onPress={onManualAdd} variant="secondary" style={{ flex: 1 }} />
                      <Button title="📷 Scan QR" onPress={() => navigation.navigate('ScanRecipients')} variant="outline" style={{ flex: 1 }} />
                   </View>
                </View>
              </View>
            ) : (
              <View style={styles.section}>
                <Button title="Pick File (CSV/Excel)" onPress={onPickFile} variant="secondary" />
                <Text style={styles.hint}>Supports .csv, .xlsx. Format: address,amount (amount optional)</Text>
              </View>
            )}
          </Card>

          <Card>
            <View style={styles.countRow}>
              <Chip label={`Total ${summary.total}`} />
              <Chip label={`Valid ${summary.valid}`} />
              <Chip label={`Invalid ${summary.invalid}`} />
              <Chip label={`Duplicates ${summary.duplicates}`} />
            </View>

            <View style={{ marginTop: spacing[4], gap: spacing[3] }}>
              <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                  <Button 
                    title="Remove Invalid" 
                    onPress={onRemoveInvalid} 
                    variant="secondary" 
                    style={{ flex: 1 }} 
                    textStyle={{ fontSize: 10 }} 
                  />
                  <Button 
                    title="Remove Duplicates" 
                    onPress={onRemoveDuplicates} 
                    variant="secondary" 
                    style={{ flex: 1 }} 
                    textStyle={{ fontSize: 10 }}
                  />
              </View>
              <Button title="Clear All" onPress={onClearAll} variant="danger" style={styles.actionBtn} />
            </View>

            <View style={styles.list}>
              {state.recipients.length === 0 ? (
                <Text style={styles.empty}>No recipients yet</Text>
              ) : (
                pagedRecipients.map((r) => {
                  const status = getRecipientStatus(r, colors);
                  return (
                    <Pressable 
                      key={r.id} 
                      style={({pressed}) => [
                        styles.row, 
                        pressed && { opacity: 0.7, borderColor: colors.primary }
                      ]} 
                      onPress={() => setEditingRecipient(r)}
                    >
                      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                         <Text style={{ fontSize: 18 }}>👤</Text>
                      </View>

                      <View style={styles.rowMain}>
                        <Text style={[styles.addr, { color: colors.text }]} numberOfLines={1} ellipsizeMode="middle">
                          {r.address}
                        </Text>
                        {r.amount ? (
                           <Text style={[styles.amount, { color: colors.textSecondary }]}>
                              Amount: <Text style={{ color: colors.primary, fontWeight: '700' }}>{r.amount}</Text>
                           </Text>
                        ) : (
                           <Text style={[styles.amount, { color: colors.textSecondary, fontStyle: 'italic' }]}>
                              No amount set
                           </Text>
                        )}
                      </View>

                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                         <View style={[styles.pill, { backgroundColor: status.bg, marginLeft: 0 }]}>
                           <Text style={[styles.pillText, { color: status.fg }]}>{status.label}</Text>
                         </View>
                         
                         <Pressable onPress={() => onRemoveById(r.id)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, padding: 4 }} accessibilityRole="button">
                           <Text style={{ fontSize: 12, color: colors.danger, fontWeight: '600' }}>Remove</Text>
                         </Pressable>
                      </View>
                    </Pressable>
                  );
                })
              )}
              {state.recipients.length > RECIPIENTS_PAGE_SIZE ? (
                <View style={{ marginTop: spacing[3], gap: spacing[2] }}>
                  <Text style={[styles.hint, { textAlign: 'center' }]}>
                    Showing recipients {recipientPage * RECIPIENTS_PAGE_SIZE + 1}-{Math.min((recipientPage + 1) * RECIPIENTS_PAGE_SIZE, state.recipients.length)} of {state.recipients.length}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                    <Button
                      title="Back"
                      onPress={() => setRecipientPage((p) => Math.max(0, p - 1))}
                      variant="secondary"
                      disabled={recipientPage === 0}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title="Next"
                      onPress={() => setRecipientPage((p) => Math.min(recipientTotalPages - 1, p + 1))}
                      variant="secondary"
                      disabled={recipientPage >= recipientTotalPages - 1}
                      style={{ flex: 1 }}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          </Card>

          {/* Amount Mode Selector (Visible always, but disabled if no recipients) */}
          <Card>
            <Text style={styles.sectionHeader}>Amount Settings</Text>
            {state.recipients.length === 0 ? (
               <Text style={styles.hint}>Add recipients first to configure amounts.</Text>
            ) : (
               <>
                 <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] }}>
                    <Button 
                      title="Equal Amount" 
                      variant={state.sendConfig.amountMode === 'equal' ? 'primary' : 'outline'} 
                      onPress={onSetEqualAmount}
                      style={{ flex: 1 }}
                    />
                    <Button 
                      title="Per-Recipient" 
                      variant={state.sendConfig.amountMode === 'perRecipient' ? 'primary' : 'outline'} 
                      onPress={onSetPerRecipient}
                      style={{ flex: 1 }}
                    />
                 </View>

                 {state.sendConfig.amountMode === 'equal' && (
                    <View>
                       {assetTab === 'NFT' ? (
                         <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                            <Text style={{ color: colors.text }}>NFTs per Recipient</Text>
                             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                               <Button title="-" onPress={() => dispatch({ type: 'sendConfig/setEqualNftCount', count: Math.max(1, state.sendConfig.equalNftCount - 1) })} variant="secondary" style={{ width: 40, height: 40 }} />
                               <Text style={{ color: colors.text, fontSize: 18, fontWeight: 'bold' }}>{state.sendConfig.equalNftCount}</Text>
                               <Button title="+" onPress={() => dispatch({ type: 'sendConfig/setEqualNftCount', count: state.sendConfig.equalNftCount + 1 })} variant="secondary" style={{ width: 40, height: 40 }} />
                             </View>
                         </View>
                       ) : (
                          <Input
                            placeholder="Amount to send (e.g. 0.5)"
                            value={state.sendConfig.equalAmountUi}
                            onChangeText={(val) => dispatch({ type: 'sendConfig/setEqualAmount', amountUi: val })}
                            keyboardType="numeric"
                            label={`Amount per recipient (${assetTab === 'SOL' ? 'SOL' : symbol || 'Token'})`}
                          />
                       )}
                       <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>
                         Applies to all {summary.valid} valid recipients.
                       </Text>
                    </View>
                 )}

                 {state.sendConfig.amountMode === 'perRecipient' && (
                    <Text style={{ color: colors.textSecondary, fontStyle: 'italic', marginTop: 8 }}>
                      Using amounts from CSV/Input. Recipients with missing amounts will be skipped or flagged.
                    </Text>
                 )}
               </>
            )}
          </Card>

          <Card>
            <Button title="Review Drop" onPress={onNext} style={styles.btn} />
          </Card>
        </>
      )}
      {/* Edit Recipient Modal */}
      {editingRecipient && (
        <EditRecipientModal
          visible={!!editingRecipient}
          onClose={() => setEditingRecipient(null)}
          onSave={onSaveEdit}
          initialAddress={editingRecipient.address}
          initialAmount={editingRecipient.amount}
        />
      )}
      </ScrollView>
    </View>
  );
}

function shortAddress(address: string) {
  const a = address.trim();
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function getRecipientStatus(r: Recipient, colors: Colors): { label: string; bg: string; fg: string } {
  if (r.isValid) return { label: 'Valid', bg: '#DCFCE7', fg: colors.success };
  if (r.error === 'duplicate') return { label: 'Duplicate', bg: colors.warningBackground, fg: colors.warningText };
  return { label: 'Invalid', bg: '#FEE2E2', fg: colors.danger };
}
