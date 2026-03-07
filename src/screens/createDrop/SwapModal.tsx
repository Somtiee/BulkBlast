import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, ActivityIndicator, Alert, Modal, ScrollView, TouchableOpacity, Image } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

import type { CreateDropStackParamList } from '../../navigation/types';
import { Button, Card, Input, Row, Screen, Chip } from '../../components/ui';
import { spacing, typography, useTheme } from '../../theme';
import { useApp } from '../../state/context';
import { JupiterSwapService, type QuoteResponse, lastRequestDiagnostics } from '../../services/JupiterSwapService';
import { getNetwork, getSolBalance, getSplBalance, getConnection, sendSol, sendSplToken, getWalletPortfolio, type TokenBalance } from '../../services/SolanaService';
import { PriceService } from '../../services/PriceService';
import { AssetMetadataService, type TokenMeta } from '../../services/AssetMetadataService';
import { JupiterTokenService } from '../../services/JupiterTokenService';
import { signTransaction, signVersionedTransaction } from '../../services/WalletService';
import { LAMPORTS_PER_SOL, PublicKey, Transaction, Connection, VersionedTransaction } from '@solana/web3.js';
import { hasJupiterApiKey } from '../../config/jupiter';
import { TOKENS, DEFAULT_SWAP_OUTPUT_MINT } from '../../config/tokens';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'SwapModal'>;

// Use centralized tokens plus any dynamic ones
const POPULAR_LIST = [TOKENS.SOL, TOKENS.USDC, TOKENS.USDT, TOKENS.JUP, TOKENS.BONK, TOKENS.SKR];

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

  // Validation
  const isMainnet = getNetwork() === 'mainnet-beta';
  const hasApiKey = hasJupiterApiKey();

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
      
      setWalletTokens(enriched);

    } catch (e) {
      console.warn('Balance load failed', e);
    }
  }

  // Refresh balance when input token changes
  useEffect(() => {
    loadBalances();
    setQuote(null);
  }, [inputToken]);

  // Fetch Input USD Price
  useEffect(() => {
    if (!amount || isNaN(parseFloat(amount))) {
      setAmountUsd(null);
      return;
    }
    const fetchPrice = async () => {
      const prices = await PriceService.getPrices([inputToken.mint]);
      const price = prices[inputToken.mint];
      if (price) {
        setAmountUsd((parseFloat(amount) * price).toFixed(2));
      }
    };
    fetchPrice();
  }, [amount, inputToken]);

  // Auto-Quote Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (amount && parseFloat(amount) > 0 && isMainnet && hasApiKey) {
        onGetQuote();
      } else {
        setQuote(null);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [amount, inputToken, outputToken, slippage]);

  async function onSearchToken(query: string) {
    setSearchQuery(query);
    if (!query) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      // 1. Check Wallet Tokens
      const walletMatches = walletTokens.filter(t => 
        t.symbol.toLowerCase().includes(query.toLowerCase()) || 
        t.name.toLowerCase().includes(query.toLowerCase())
      );
      
      // 2. Jupiter Search (includes strict list + mint search)
      const jupMatches = await JupiterTokenService.searchTokens(query);
      
      // Merge: Wallet > Jup Matches
      const combined = [...walletMatches];
      
      for (const m of jupMatches) {
        if (!combined.find(c => c.mint === m.mint)) {
          combined.push(m);
        }
      }
      
      setSearchResults(combined);
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
  }

  async function onGetQuote() {
    if (!state.walletPublicKey) return;
    setLoading(true);
    setLastError(null);
    
    try {
      const amountFloat = parseFloat(amount);
      if (isNaN(amountFloat) || amountFloat <= 0) return;
      
      const lamports = Math.round(amountFloat * Math.pow(10, inputToken.decimals || 9));
      
      const q = await JupiterSwapService.getQuote({
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amountLamports: lamports.toString(),
        slippageBps: slippage,
      });
      setQuote(q);
    } catch (e: any) {
      console.error(e);
      setLastError(e.message);
      setQuote(null);
    } finally {
      setLoading(false);
    }
  }

  async function onSwap() {
    if (!quote || !state.walletPublicKey) return;
    setSwapping(true);
    try {
      // 1. Get Swap Transaction
      const { swapTransactionBase64 } = await JupiterSwapService.getSwapTransaction({
        quoteResponse: quote,
        userPublicKey: state.walletPublicKey,
      });

      // 2. Deserialize
      const transaction = JupiterSwapService.deserializeSwapTransaction(swapTransactionBase64);

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

      // 4. Confirm
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) throw new Error('Swap transaction failed on chain.');

      Alert.alert('Success', `Swapped! Signature: ${signature.slice(0, 8)}...`);
      loadBalances(); // Refresh balances
      setAmount('');
      setQuote(null);

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
    <Screen title="Swap" subtitle="Powered by Jupiter">
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
                 ) : quote ? (
                    <Text style={{ fontSize: 24, fontWeight: 'bold', color: colors.text }}>
                       {(parseInt(quote.outAmount) / Math.pow(10, outputToken.decimals || 9)).toFixed(4)}
                    </Text>
                 ) : (
                    <Text style={{ fontSize: 24, fontWeight: 'bold', color: colors.textSecondary }}>0.00</Text>
                 )}
              </View>
           </View>
        </View>
        
        {/* INFO / SETTINGS */}
        {quote && (
          <View style={styles.infoSection}>
             <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Rate</Text>
                <Text style={styles.infoValue}>1 {inputToken.symbol} ≈ {((parseInt(quote.outAmount) / Math.pow(10, outputToken.decimals || 9)) / parseFloat(amount)).toFixed(4)} {outputToken.symbol}</Text>
             </View>
             <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Price Impact</Text>
                <Text style={[styles.infoValue, parseFloat(quote.priceImpactPct) > 1 && { color: colors.danger }]}>
                   {parseFloat(quote.priceImpactPct) < 0.01 ? '< 0.01%' : `${quote.priceImpactPct}%`}
                </Text>
             </View>
             <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Route</Text>
                <Text style={styles.infoValue}>Jupiter • {quote.routePlan?.length || 1} Hop(s)</Text>
             </View>
          </View>
        )}

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
              {lastRequestDiagnostics && (
                 <>
                   <Text style={styles.debugText}>Status: {lastRequestDiagnostics.status}</Text>
                   <Text style={styles.debugText}>API Key: {lastRequestDiagnostics.apiKeyPresent ? 'Yes' : 'No'}</Text>
                 </>
              )}
           </View>
        )}

        {/* MAIN CTA */}
        <View style={{ marginTop: spacing[6] }}>
           {!isMainnet ? (
              <Button title="Swaps are Mainnet-Only" disabled variant="secondary" onPress={() => {}} />
           ) : !hasApiKey ? (
              <Button title="API Key Missing (Check Config)" disabled variant="secondary" onPress={() => {}} />
           ) : !amount ? (
              <Button title="Enter Amount" disabled variant="secondary" onPress={() => {}} />
           ) : quote ? (
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

            <ScrollView contentContainerStyle={{ paddingHorizontal: spacing[4] }}>
               {/* Search Results */}
               {searchQuery ? (
                  searchResults.map(t => (
                     <TouchableOpacity key={t.mint} style={styles.tokenListRow} onPress={() => onSelectToken(t)}>
                        <Image source={{ uri: t.iconUrl }} style={styles.listIcon} />
                        <View>
                           <Text style={[styles.listSymbol, { color: colors.text }]}>{t.symbol}</Text>
                           <Text style={[styles.listName, { color: colors.textSecondary }]}>{t.name}</Text>
                        </View>
                        <Text style={[styles.listMint, { color: colors.textSecondary }]}>{t.mint.slice(0, 4)}...{t.mint.slice(-4)}</Text>
                     </TouchableOpacity>
                  ))
               ) : (
                  <>
                     <Text style={styles.sectionTitle}>Your Tokens</Text>
                     {walletTokens.map(t => (
                        <TouchableOpacity key={t.mint} style={styles.tokenListRow} onPress={() => onSelectToken(t)}>
                           <Image source={{ uri: t.iconUrl }} style={styles.listIcon} />
                           <View>
                              <Text style={[styles.listSymbol, { color: colors.text }]}>{t.symbol}</Text>
                              <Text style={[styles.listName, { color: colors.textSecondary }]}>{t.name}</Text>
                           </View>
                        </TouchableOpacity>
                     ))}
                     
                     <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Popular Tokens</Text>
                     {POPULAR_LIST.map(t => (
                        <TouchableOpacity key={t.mint} style={styles.tokenListRow} onPress={() => onSelectToken(t)}>
                           <Image source={{ uri: t.iconUrl }} style={styles.listIcon} />
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
});
