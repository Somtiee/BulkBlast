import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, StyleSheet, Text, ActivityIndicator, Alert, Modal, ScrollView, TouchableOpacity, Image } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

import type { CreateDropStackParamList } from '../../navigation/types';
import { Button, Card, Input, Row, Screen, Chip } from '../../components/ui';
import { spacing, typography, useTheme } from '../../theme';
import { useApp } from '../../state/context';
import { JupiterSwapService, type QuoteResponse, lastRequestDiagnostics } from '../../services/JupiterSwapService';
import {
  DflowSwapService,
  type DflowQuoteResponse,
  lastDflowRequestDiagnostics,
} from '../../services/DflowSwapService';
import {
  getNetwork,
  getSolBalance,
  getSplBalance,
  getConnection,
  sendSol,
  sendSplToken,
  getWalletPortfolio,
  getSplTokenInfo,
  type TokenBalance,
} from '../../services/SolanaService';
import { PriceService } from '../../services/PriceService';
import { AssetMetadataService, type TokenMeta } from '../../services/AssetMetadataService';
import { JupiterTokenService } from '../../services/JupiterTokenService';
import { signTransaction, signVersionedTransaction } from '../../services/WalletService';
import { LAMPORTS_PER_SOL, PublicKey, Transaction, Connection, VersionedTransaction } from '@solana/web3.js';
import { hasJupiterApiKey } from '../../config/jupiter';
import { isDflowConfigured } from '../../config/dflow';
import { TOKENS, DEFAULT_SWAP_OUTPUT_MINT } from '../../config/tokens';
import { ConfettiBurst } from '../../components/ui/ConfettiBurst';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'SwapModal'>;
type RouteProvider = 'jupiter' | 'dflow';
type RouteQuote = {
  provider: RouteProvider;
  quote: QuoteResponse | DflowQuoteResponse;
  outAmount: string;
  priceImpactPct: string;
  hops: number;
};

// Use centralized tokens plus any dynamic ones
const POPULAR_LIST = [TOKENS.SOL, TOKENS.USDC, TOKENS.USDT, TOKENS.JUP, TOKENS.BONK, TOKENS.SKR];

/** Returns trimmed mint if `input` is a valid Solana address, else null. */
function tryParseMintAddress(input: string): string | null {
  const t = input.trim();
  if (!t) return null;
  try {
    new PublicKey(t);
    return t;
  } catch {
    return null;
  }
}

function isSeekerAliasNotCanonical(token: TokenMeta): boolean {
  const sym = (token.symbol || '').toUpperCase();
  const name = (token.name || '').toUpperCase();
  const seekerLike = sym === 'SEEKER' || name.includes('SEEKER');
  return seekerLike && token.mint !== TOKENS.SKR.mint;
}

function dedupeAndNormalizeTokens(tokens: TokenMeta[]): TokenMeta[] {
  const out = new Map<string, TokenMeta>();
  for (const t of tokens) {
    if (!t?.mint) continue;
    if (isSeekerAliasNotCanonical(t)) continue;

    const canonical =
      t.mint === TOKENS.SOL.mint
        ? TOKENS.SOL
        : t.mint === TOKENS.USDC.mint
        ? TOKENS.USDC
        : t.mint === TOKENS.USDT.mint
        ? TOKENS.USDT
        : t.mint === TOKENS.JUP.mint
        ? TOKENS.JUP
        : t.mint === TOKENS.BONK.mint
        ? TOKENS.BONK
        : t.mint === TOKENS.SKR.mint
        ? TOKENS.SKR
        : t;

    if (!out.has(canonical.mint)) out.set(canonical.mint, canonical);
  }
  return Array.from(out.values());
}

export function SwapModal({ navigation }: Props) {
  const { state, dispatch } = useApp();
  const { colors } = useTheme();
  
  // Swap State
  const [inputToken, setInputToken] = useState<TokenMeta>(TOKENS.SOL);
  const [outputToken, setOutputToken] = useState<TokenMeta>(TOKENS.SKR);
  
  const [amount, setAmount] = useState('0.1');
  const [inputBalance, setInputBalance] = useState<string>('0');
  const [amountUsd, setAmountUsd] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [routeQuotes, setRouteQuotes] = useState<RouteQuote[]>([]);
  const [selectedRouteProvider, setSelectedRouteProvider] = useState<RouteProvider>('jupiter');
  const [swapping, setSwapping] = useState(false);
  const [slippage, setSlippage] = useState<number>(50); // 0.5% default
  
  // Token Selection Modal
  const [selectorVisible, setSelectorVisible] = useState(false);
  const [selectingSide, setSelectingSide] = useState<'input' | 'output'>('input');
  const [searchQuery, setSearchQuery] = useState('');
  const [walletTokens, setWalletTokens] = useState<TokenMeta[]>([]);
  const [searchResults, setSearchResults] = useState<TokenMeta[]>([]);
  const [searching, setSearching] = useState(false);

  const [showDebug, setShowDebug] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Swap success UX
  const [swapSuccessVisible, setSwapSuccessVisible] = useState(false);
  const [swapSuccessSignature, setSwapSuccessSignature] = useState('');
  const successScale = useRef(new Animated.Value(0.9)).current;
  const successFade = useRef(new Animated.Value(0)).current;
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [signatureCopied, setSignatureCopied] = useState(false);
  const signatureCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validation
  const isMainnet = getNetwork() === 'mainnet-beta';
  const hasApiKey = hasJupiterApiKey();
  const hasDflow = isDflowConfigured();

  // Load Wallet Balances & Tokens
  useEffect(() => {
    if (state.walletPublicKey) {
      loadBalances();
    }
  }, [state.walletPublicKey]);

  async function loadBalances() {
    if (!state.walletPublicKey) return;
    try {
      // Get Portfolio
      const portfolio = await getWalletPortfolio(state.walletPublicKey, state.feeTokenMint);
      
      // Update Input Balance
      if (inputToken.mint === TOKENS.SOL.mint) {
         setInputBalance(portfolio.sol);
      } else {
         const t = portfolio.tokens.find(t => t.mint === inputToken.mint);
         setInputBalance(t?.balance || '0');
      }

      // Enrich Wallet Tokens for Selector
      const enriched = await Promise.all(portfolio.tokens.map(async (t) => {
         const meta = await AssetMetadataService.getMetadata(t.mint);
         return meta || { mint: t.mint, symbol: t.symbol, name: 'Unknown', decimals: 0 };
      }));
      
      // Add SOL if not present
      if (!enriched.find(t => t.mint === TOKENS.SOL.mint)) {
         enriched.unshift(TOKENS.SOL);
      }
      
      setWalletTokens(dedupeAndNormalizeTokens(enriched));

    } catch (e) {
      console.warn('Balance load failed', e);
    }
  }

  // Refresh balance when input token changes
  useEffect(() => {
    loadBalances();
    setQuote(null);
    setRouteQuotes([]);
  }, [inputToken]);

  // Fetch Input USD Price
  useEffect(() => {
    if (!amount || isNaN(parseFloat(amount))) {
      setAmountUsd(null);
      return;
    }
    const fetchPrice = async () => {
      try {
        const prices = await PriceService.getTokenUsdPrices([inputToken.mint]);
        const price = prices[inputToken.mint];
        if (price) {
          setAmountUsd((parseFloat(amount) * price).toFixed(2));
        } else {
          setAmountUsd(null);
        }
      } catch (e) {
        // Keep swap UX alive even when pricing API fails.
        setAmountUsd(null);
      }
    };
    fetchPrice();
  }, [amount, inputToken]);

  // Auto-Quote Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (amount && parseFloat(amount) > 0 && isMainnet && (hasApiKey || hasDflow)) {
        onGetQuote();
      } else {
        setQuote(null);
        setRouteQuotes([]);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [amount, inputToken, outputToken, slippage]);

  async function onSearchToken(query: string) {
    setSearchQuery(query);
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      // 1. Check Wallet Tokens
      const walletMatches = walletTokens.filter(t => 
        t.symbol.toLowerCase().includes(q.toLowerCase()) || 
        t.name.toLowerCase().includes(q.toLowerCase()) ||
        t.mint.toLowerCase().includes(q.toLowerCase())
      );
      
      // 2. Jupiter Search (includes strict list + mint search)
      const jupMatches = await JupiterTokenService.searchTokens(q);
      
      // Merge: Wallet > Jup Matches
      const combined = [...walletMatches];
      
      for (const m of jupMatches) {
        if (!combined.find(c => c.mint === m.mint)) {
          combined.push(m);
        }
      }

      // 3. Direct mint fallback for fresh launches (e.g. Bags) not in Jupiter strict list yet.
      const mintPk = tryParseMintAddress(q);
      if (mintPk && !combined.find((c) => c.mint === mintPk)) {
        try {
          const info = await getSplTokenInfo(mintPk);
          const meta = await AssetMetadataService.getMetadata(mintPk);
          combined.push({
            mint: mintPk,
            symbol: meta?.symbol || `${mintPk.slice(0, 4)}...${mintPk.slice(-4)}`,
            name: meta?.name || 'SPL Token',
            iconUrl: meta?.iconUrl,
            decimals: meta?.decimals ?? info.decimals ?? 9,
          });
        } catch {
          // invalid mint or RPC/network — user may need full mint + mainnet
        }
      }
      
      setSearchResults(dedupeAndNormalizeTokens(combined));
    } catch (e) {
      console.warn('Search failed', e);
    } finally {
      setSearching(false);
    }
  }

  function onSelectToken(token: TokenMeta) {
    if (selectingSide === 'input') {
      setInputToken(token);
    } else {
      setOutputToken(token);
    }
    setSelectorVisible(false);
    setSearchQuery('');
    setSearchResults([]);
  }

  function onSwitchSides() {
    const temp = inputToken;
    setInputToken(outputToken);
    setOutputToken(temp);
    setAmount(''); 
    setQuote(null);
    setRouteQuotes([]);
  }

  async function onGetQuote() {
    if (!state.walletPublicKey) return;
    setLoading(true);
    setLastError(null);
    
    try {
      const amountFloat = parseFloat(amount);
      if (isNaN(amountFloat) || amountFloat <= 0) return;
      
      const decimals = inputToken.decimals ?? 9;
      const lamports = Math.round(amountFloat * Math.pow(10, decimals));
      
      const quotePromises: Array<Promise<RouteQuote | null>> = [];

      if (hasApiKey) {
        quotePromises.push(
          JupiterSwapService.getQuote({
            inputMint: inputToken.mint,
            outputMint: outputToken.mint,
            amountLamports: lamports.toString(),
            slippageBps: slippage,
          })
            .then((q) => ({
              provider: 'jupiter' as const,
              quote: q,
              outAmount: q.outAmount,
              priceImpactPct: q.priceImpactPct || '0',
              hops: q.routePlan?.length || 1,
            }))
            .catch(() => null)
        );
      }

      if (hasDflow) {
        quotePromises.push(
          DflowSwapService.getQuote({
            inputMint: inputToken.mint,
            outputMint: outputToken.mint,
            amountLamports: lamports.toString(),
            slippageBps: slippage,
          })
            .then((q) => ({
              provider: 'dflow' as const,
              quote: q,
              outAmount: q.outAmount,
              priceImpactPct: q.priceImpactPct || '0',
              hops: q.routePlan?.length || 1,
            }))
            .catch(() => null)
        );
      }

      const allQuotes = (await Promise.all(quotePromises)).filter((q): q is RouteQuote => !!q);
      if (!allQuotes.length) throw new Error('No route found from Jupiter or DFLOW');

      allQuotes.sort((a, b) => parseInt(b.outAmount, 10) - parseInt(a.outAmount, 10));
      setRouteQuotes(allQuotes);
      setSelectedRouteProvider(allQuotes[0].provider);
      setQuote(allQuotes[0].provider === 'jupiter' ? (allQuotes[0].quote as QuoteResponse) : null);
      
    } catch (e: any) {
      console.warn('Quote error', e);
      setLastError(e.message || 'Failed to get quote');
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }

  function getOutputAmountUi() {
    const selected =
      routeQuotes.find((r) => r.provider === selectedRouteProvider) || routeQuotes[0];
    if (!selected) return '0.00';
    const raw = parseInt(selected.outAmount);
    // Use outputToken decimals if available, fallback to 6 (typical for SPL like USDC/SKR) or 9 (SOL)
    const decimals = outputToken.decimals ?? 6; 
    return (raw / Math.pow(10, decimals)).toFixed(4);
  }

  async function onSwap() {
    const selected =
      routeQuotes.find((r) => r.provider === selectedRouteProvider) || routeQuotes[0];
    if (!selected || !state.walletPublicKey) return;
    setSwapping(true);
    try {
      let swapTransactionBase64 = '';
      let txProvider: RouteProvider = selected.provider;
      try {
        if (selected.provider === 'jupiter') {
          const res = await JupiterSwapService.getSwapTransaction({
            quoteResponse: selected.quote as QuoteResponse,
            userPublicKey: state.walletPublicKey,
          });
          swapTransactionBase64 = res.swapTransactionBase64;
        } else {
          const res = await DflowSwapService.getSwapTransaction({
            quoteResponse: selected.quote as DflowQuoteResponse,
            userPublicKey: state.walletPublicKey,
          });
          swapTransactionBase64 = res.swapTransactionBase64;
        }
      } catch (routeErr) {
        // If DFLOW build fails, gracefully fallback to Jupiter route if present.
        const jupiterFallback = routeQuotes.find((r) => r.provider === 'jupiter');
        if (selected.provider === 'dflow' && jupiterFallback) {
          const res = await JupiterSwapService.getSwapTransaction({
            quoteResponse: jupiterFallback.quote as QuoteResponse,
            userPublicKey: state.walletPublicKey,
          });
          swapTransactionBase64 = res.swapTransactionBase64;
          txProvider = 'jupiter';
        } else {
          throw routeErr;
        }
      }

      // 2. Deserialize
      const transaction =
        txProvider === 'jupiter'
          ? JupiterSwapService.deserializeSwapTransaction(swapTransactionBase64)
          : DflowSwapService.deserializeSwapTransaction(swapTransactionBase64);

      // 3. Sign & Send
      const connection = getConnection();
      let signature: string;

      if (state.walletMode === 'built_in') {
        let signedTx;
        if ('version' in transaction) {
           // Versioned Transaction (Jupiter default)
           signedTx = await signVersionedTransaction(transaction as VersionedTransaction);
        } else {
           // Legacy Transaction (Fallback)
           signedTx = await signTransaction(transaction as Transaction);
        }
        
        // Send raw
        const raw = signedTx.serialize();
        signature = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 2 });
      } else {
        // TODO: Adapter support
        throw new Error('Please use built-in wallet for swaps currently.');
      }

      // 4. Confirm (robust: timeout + polling fallback for mobile/RPC quirks)
      await confirmSignatureRobust(connection, signature);

      // Success modal w/ animation + confetti
      setSwapSuccessSignature(signature);
      setSwapSuccessVisible(true);
      setSignatureCopied(false);
      Animated.parallel([
        Animated.spring(successScale, {
          toValue: 1,
          friction: 7,
          tension: 80,
          useNativeDriver: true,
        }),
        Animated.timing(successFade, {
          toValue: 1,
          duration: 250,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();

      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setSwapSuccessVisible(false);
      }, 2400);

      loadBalances(); // Refresh balances
      setAmount('');
      setQuote(null);
      setRouteQuotes([]);

    } catch (e: any) {
      console.error(e);
      Alert.alert('Swap Failed', e.message);
    } finally {
      setSwapping(false);
    }
  }

  // --- RENDER HELPERS ---
  
  const renderTokenButton = (token: TokenMeta, side: 'input' | 'output') => (
    <TouchableOpacity 
      style={styles.tokenSelectBtn} 
      onPress={() => { setSelectingSide(side); setSelectorVisible(true); }}
    >
      {token.iconUrl ? (
        <Image source={{ uri: token.iconUrl }} style={styles.tokenIcon} />
      ) : (
        <View style={[styles.tokenIcon, { backgroundColor: '#333' }]} />
      )}
      <Text style={styles.tokenSymbol}>{token.symbol}</Text>
      <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
    </TouchableOpacity>
  );

  return (
    <Screen title="Swap" subtitle="Aggregator (Jupiter + DFLOW)">
      <View style={{ padding: spacing[4] }}>
        
        {/* SELL CARD */}
        <View style={[styles.swapCard, { backgroundColor: colors.surface }]}>
           <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>You Pay</Text>
              <Text style={styles.balanceText}>
                 Bal: {parseFloat(inputBalance).toFixed(4)}
                 <Text style={{ color: colors.primary, fontWeight: 'bold' }} onPress={() => setAmount(inputBalance)}> MAX</Text>
              </Text>
           </View>
           
           <View style={styles.inputRow}>
              {renderTokenButton(inputToken, 'input')}
              <View style={{ flex: 1 }}>
                 <Input
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="numeric"
                    placeholder="0.00"
                    inputStyle={{ textAlign: 'right', fontSize: 24, fontWeight: 'bold', padding: 0, height: 40, borderWidth: 0 }}
                    style={{ borderWidth: 0, backgroundColor: 'transparent' }}
                 />
                 {amountUsd && <Text style={styles.fiatText}>≈ ${amountUsd}</Text>}
              </View>
           </View>
        </View>

        {/* SWITCH BUTTON */}
        <View style={{ alignItems: 'center', marginVertical: -16, zIndex: 10 }}>
           <TouchableOpacity onPress={onSwitchSides} style={[styles.switchBtn, { backgroundColor: colors.surface2, borderColor: colors.background }]}>
              <Ionicons name="arrow-down" size={20} color={colors.primary} />
           </TouchableOpacity>
        </View>

        {/* BUY CARD */}
        <View style={[styles.swapCard, { backgroundColor: colors.surface }]}>
           <View style={styles.cardHeader}>
              <Text style={styles.cardLabel}>You Receive</Text>
           </View>
           
           <View style={styles.inputRow}>
              {renderTokenButton(outputToken, 'output')}
              <View style={{ flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>
                 {loading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                 ) : routeQuotes.length > 0 ? (
                    <Text style={{ fontSize: 24, fontWeight: 'bold', color: colors.text }}>
                       {getOutputAmountUi()}
                    </Text>
                 ) : (
                    <Text style={{ fontSize: 24, fontWeight: 'bold', color: colors.textSecondary }}>0.00</Text>
                 )}
              </View>
           </View>
        </View>
        
        {/* INFO / SETTINGS */}
        {routeQuotes.length > 0 && (() => {
          const activeRoute = routeQuotes.find((r) => r.provider === selectedRouteProvider) || routeQuotes[0];
          return (
          <View style={styles.infoSection}>
             <Text style={[styles.infoLabel, { marginBottom: 8 }]}>Route</Text>
             {routeQuotes.map((rq, idx) => {
                const isActive = rq.provider === selectedRouteProvider;
                return (
                  <TouchableOpacity
                    key={rq.provider}
                    activeOpacity={0.7}
                    onPress={() => {
                      setSelectedRouteProvider(rq.provider);
                      setQuote(rq.provider === 'jupiter' ? (rq.quote as QuoteResponse) : null);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 12,
                      borderRadius: 12,
                      marginBottom: 6,
                      borderWidth: 1.5,
                      borderColor: isActive ? colors.primary : 'rgba(255,255,255,0.08)',
                      backgroundColor: isActive ? colors.primary + '14' : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{
                        width: 18, height: 18, borderRadius: 9,
                        borderWidth: 2,
                        borderColor: isActive ? colors.primary : '#555',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        {isActive && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }} />}
                      </View>
                      <Text style={{ color: isActive ? colors.primary : '#ccc', fontWeight: '700', fontSize: 14 }}>
                        {rq.provider === 'jupiter' ? 'Jupiter' : 'DFLOW'}
                      </Text>
                      {idx === 0 && (
                        <View style={{ backgroundColor: colors.primary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>BEST</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ color: '#ccc', fontWeight: '600', fontSize: 14 }}>
                      {formatRawAmount(rq.outAmount, outputToken.decimals ?? 6)} {outputToken.symbol}
                    </Text>
                  </TouchableOpacity>
                );
             })}
             <View style={[styles.infoRow, { marginTop: 8 }]}>
                <Text style={styles.infoLabel}>Rate</Text>
                <Text style={styles.infoValue}>1 {inputToken.symbol} ≈ {(parseFloat(getOutputAmountUi()) / Math.max(parseFloat(amount || '0'), 0.0000001)).toFixed(4)} {outputToken.symbol}</Text>
             </View>
             <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Price Impact</Text>
                <Text style={[styles.infoValue, parseFloat(activeRoute.priceImpactPct) > 1 && { color: colors.danger }]}>
                   {parseFloat(activeRoute.priceImpactPct) < 0.01 ? '< 0.01%' : `${activeRoute.priceImpactPct}%`}
                </Text>
             </View>
             <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Via</Text>
                <Text style={styles.infoValue}>
                  {activeRoute.provider === 'jupiter' ? 'Jupiter' : 'DFLOW'} • {activeRoute.hops || 1} Hop(s)
                </Text>
             </View>
          </View>
          );
        })()}

        {/* Slippage & Debug */}
        <View style={{ marginTop: spacing[4], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
           <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.infoLabel}>Slippage</Text>
              {[50, 100].map(bps => (
                 <TouchableOpacity key={bps} onPress={() => setSlippage(bps)} style={[styles.slipBtn, slippage === bps && { backgroundColor: colors.primary }]}>
                    <Text style={[styles.slipText, slippage === bps && { color: '#fff' }]}>{bps/100}%</Text>
                 </TouchableOpacity>
              ))}
           </View>
           {lastError && (
              <TouchableOpacity onPress={() => setShowDebug(!showDebug)}>
                 <Text style={{ color: colors.danger, fontSize: 10 }}>Error Details</Text>
              </TouchableOpacity>
           )}
        </View>

        {showDebug && lastError && (
           <View style={styles.debugBox}>
              <Text style={styles.debugText}>{lastError}</Text>
              {(lastRequestDiagnostics || lastDflowRequestDiagnostics) && (
                 <>
                   <Text style={styles.debugText}>Jupiter Status: {lastRequestDiagnostics?.status ?? 'N/A'}</Text>
                   <Text style={styles.debugText}>DFLOW Status: {lastDflowRequestDiagnostics?.status ?? 'N/A'}</Text>
                 </>
              )}
           </View>
        )}

        {/* MAIN CTA */}
        <View style={{ marginTop: spacing[6] }}>
           {!isMainnet ? (
              <Button title="Swaps are Mainnet-Only" disabled variant="secondary" onPress={() => {}} />
          ) : !hasApiKey && !hasDflow ? (
              <Button title="No Swap Provider Configured" disabled variant="secondary" onPress={() => {}} />
           ) : !amount ? (
              <Button title="Enter Amount" disabled variant="secondary" onPress={() => {}} />
           ) : routeQuotes.length > 0 ? (
              <Button title={swapping ? "Swapping..." : "Swap"} onPress={onSwap} disabled={swapping} variant="primary" style={{ height: 56 }} textStyle={{ fontSize: 18 }} />
           ) : (
              <Button title={loading ? "Getting Quote..." : "Get Quote"} disabled variant="secondary" onPress={() => {}} />
           )}
        </View>

      </View>

      {/* TOKEN SELECTOR MODAL */}
      <Modal visible={selectorVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectorVisible(false)}>
         <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
            <View style={styles.modalHeader}>
               <Text style={styles.modalTitle}>Select Token</Text>
               <TouchableOpacity onPress={() => setSelectorVisible(false)}>
                  <Ionicons name="close" size={24} color={colors.text} />
               </TouchableOpacity>
            </View>
            
            <View style={{ padding: spacing[4] }}>
               <Input 
                  placeholder="Search name or mint address"
                  value={searchQuery}
                  onChangeText={onSearchToken}
                  autoFocus
               />
            </View>

            <ScrollView contentContainerStyle={{ paddingHorizontal: spacing[4], paddingBottom: spacing[8] }}>
               {/* Search Results */}
               {searchQuery ? (
                  searching ? (
                    <View style={{ paddingVertical: spacing[6], alignItems: 'center' }}>
                      <ActivityIndicator color={colors.primary} />
                      <Text style={{ marginTop: spacing[2], color: colors.textSecondary, fontSize: 12 }}>Searching…</Text>
                    </View>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((t) => (
                      <TouchableOpacity key={t.mint} style={styles.tokenListRow} onPress={() => onSelectToken(t)}>
                        {t.iconUrl ? (
                          <Image source={{ uri: t.iconUrl }} style={styles.listIcon} />
                        ) : (
                          <View style={styles.listIcon} />
                        )}
                        <View>
                          <Text style={[styles.listSymbol, { color: colors.text }]}>{t.symbol}</Text>
                          <Text style={[styles.listName, { color: colors.textSecondary }]}>{t.name}</Text>
                        </View>
                        <Text style={[styles.listMint, { color: colors.textSecondary }]}>
                          {t.mint.slice(0, 4)}...{t.mint.slice(-4)}
                        </Text>
                      </TouchableOpacity>
                    ))
                  ) : (
                    <Text style={{ color: colors.textSecondary, fontSize: 13, paddingVertical: spacing[4] }}>
                      No matches. Paste the full token mint (complete address). Short fragments won’t work. New Bags tokens may
                      not appear in search until the mint is fetched — ensure you’re on mainnet with RPC working.
                    </Text>
                  )
               ) : (
                  <>
                     <Text style={styles.sectionTitle}>Your Tokens</Text>
                     {walletTokens.map(t => (
                        <TouchableOpacity key={t.mint} style={styles.tokenListRow} onPress={() => onSelectToken(t)}>
                           {t.iconUrl ? (
                             <Image source={{ uri: t.iconUrl }} style={styles.listIcon} />
                           ) : (
                             <View style={styles.listIcon} />
                           )}
                           <View>
                              <Text style={[styles.listSymbol, { color: colors.text }]}>{t.symbol}</Text>
                              <Text style={[styles.listName, { color: colors.textSecondary }]}>{t.name}</Text>
                           </View>
                        </TouchableOpacity>
                     ))}
                     
                     <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Popular Tokens</Text>
                     {POPULAR_LIST.filter((t) => !walletTokens.some((w) => w.mint === t.mint)).map(t => (
                        <TouchableOpacity key={t.mint} style={styles.tokenListRow} onPress={() => onSelectToken(t)}>
                           {t.iconUrl ? (
                             <Image source={{ uri: t.iconUrl }} style={styles.listIcon} />
                           ) : (
                             <View style={styles.listIcon} />
                           )}
                           <View>
                              <Text style={[styles.listSymbol, { color: colors.text }]}>{t.symbol}</Text>
                              <Text style={[styles.listName, { color: colors.textSecondary }]}>{t.name}</Text>
                           </View>
                        </TouchableOpacity>
                     ))}
                  </>
               )}
            </ScrollView>
         </View>
      </Modal>

      {/* Swap success modal */}
      <Modal
        visible={swapSuccessVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSwapSuccessVisible(false)}
      >
        <View style={[styles.successOverlay, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
          <Animated.View
            style={[
              styles.successCard,
              {
                opacity: successFade,
                transform: [{ scale: successScale }],
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <ConfettiBurst density={44} />
            <View style={{ alignItems: 'center', paddingTop: 6 }}>
              <Text style={[styles.successTitle, { color: colors.text }]}>Swap Success</Text>
              {swapSuccessSignature ? (
                <>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={async () => {
                      try {
                        await Clipboard.setStringAsync(swapSuccessSignature);
                        setSignatureCopied(true);
                        if (signatureCopiedTimerRef.current) clearTimeout(signatureCopiedTimerRef.current);
                        signatureCopiedTimerRef.current = setTimeout(() => setSignatureCopied(false), 1200);
                      } catch {
                        // ignore copy failures
                      }
                    }}
                    style={{ marginTop: spacing[1] }}
                  >
                    <Text
                      style={[
                        styles.successSub,
                        { color: colors.textSecondary, textDecorationLine: 'underline' },
                      ]}
                      numberOfLines={1}
                    >
                      Tap to copy tx: {`${swapSuccessSignature.slice(0, 8)}...`}
                    </Text>
                  </TouchableOpacity>
                  {signatureCopied ? (
                    <Text style={[styles.successSub, { color: colors.success, marginTop: spacing[1] }]}>Copied</Text>
                  ) : null}
                </>
              ) : null}
            </View>

            <View style={{ marginTop: spacing[4] }}>
              <Button
                title="Done"
                onPress={() => setSwapSuccessVisible(false)}
                variant="primary"
                style={{ height: 52 }}
              />
            </View>
          </Animated.View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  swapCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardLabel: {
    color: '#888',
    fontSize: 14,
  },
  balanceText: {
    color: '#888',
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tokenSelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 24,
    gap: 8,
  },
  tokenIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  tokenSymbol: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  fiatText: {
    color: '#666',
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
  },
  switchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  infoSection: {
    marginTop: 16,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  infoLabel: {
    color: '#888',
    fontSize: 12,
  },
  infoValue: {
    color: '#ccc',
    fontSize: 12,
    fontWeight: '500',
  },
  slipBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  slipText: {
    fontSize: 10,
    color: '#888',
  },
  debugBox: {
    marginTop: 12,
    padding: 8,
    backgroundColor: '#000',
    borderRadius: 4,
  },
  debugText: {
    color: '#f00',
    fontFamily: 'monospace',
    fontSize: 10,
  },
  
  // Modal Styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    marginTop: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  tokenListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  listIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 12,
    backgroundColor: '#333',
  },
  listSymbol: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  listName: {
    fontSize: 12,
  },
  listMint: {
    marginLeft: 'auto',
    fontSize: 10,
  },

  successOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  successCard: {
    width: '100%',
    borderRadius: 20,
    padding: spacing[4],
    borderWidth: 1,
    alignItems: 'center',
    overflow: 'hidden',
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  successSub: {
    marginTop: spacing[2],
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});

function formatRawAmount(rawAmount: string, decimals: number): string {
  const raw = parseInt(rawAmount || '0', 10);
  if (!raw || Number.isNaN(raw)) return '0.00';
  return (raw / Math.pow(10, decimals)).toFixed(4);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mobile networks/RPC websockets can leave `confirmTransaction` hanging even when
 * a swap lands on-chain. We add timeout + polling fallback to keep UI state correct.
 */
async function confirmSignatureRobust(
  connection: Connection,
  signature: string,
  opts?: { timeoutMs?: number; pollMs?: number }
): Promise<void> {
  const timeoutMs = opts?.timeoutMs ?? 35000;
  const pollMs = opts?.pollMs ?? 1500;

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Confirmation timeout reached')), timeoutMs)
  );

  try {
    const confirmation = await Promise.race([
      connection.confirmTransaction(signature, 'confirmed'),
      timeoutPromise,
    ]);
    if (confirmation.value.err) {
      throw new Error('Swap transaction failed on chain.');
    }
    return;
  } catch {
    // Fallback to status polling below.
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status?.err) {
      throw new Error('Swap transaction failed on chain.');
    }
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return;
    }
    await sleep(pollMs);
  }

  throw new Error(
    `Swap submitted but confirmation is delayed. Signature: ${signature.slice(0, 8)}...`
  );
}
