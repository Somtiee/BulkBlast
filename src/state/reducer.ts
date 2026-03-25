import type { AppAction, AppState } from './types';
import { dedupeAndValidate } from '../utils/recipients';
import { FEE_TOKEN_MINT } from '../config/tokens';

export const initialAppState: AppState = {
  walletMode: null,
  walletPublicKey: null,
  builtInWalletStatus: 'none',
  // Mainnet Seeker Mint (SKR)
  feeTokenMint: FEE_TOKEN_MINT, 
  // Mainnet Treasury
  treasuryAddress: '9G8DEvKZmc1ssMyMmxd969GhCMaVT2eYtjGTzwDBshKt', 
  seekerDiscountEnabled: false,
  solanaMobileOwner: false,
  network: 'mainnet-beta', // Default to mainnet
  sendConfig: {
    batchSize: 10,
    createRecipientAtaIfMissing: true,
    maxTotalSolUi: '0.5',
    maxRecipients: 1000,
    requireDoubleConfirm: true,
    amountMode: 'perRecipient',
    equalAmountUi: '',
    equalNftCount: 1,
  },
  giveawayConfig: {
    enabled: false,
    winnerCount: 1,
    selectedRecipientIds: [],
  },
  swapConfig: { enabled: true, provider: 'jupiter_like_stub' },
  recipients: [],
  selectedAsset: null,
  assetBalance: null,
  feeQuote: null,
  launchBlastFreeFeeAvailable: false,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'wallet/connectedAdapter':
      return {
        ...state,
        walletMode: 'adapter',
        walletPublicKey: action.publicKey,
        builtInWalletStatus: state.builtInWalletStatus,
      };
    case 'wallet/createdBuiltIn':
    case 'wallet/importedBuiltIn':
    case 'wallet/unlockedBuiltIn':
      return {
        ...state,
        walletMode: 'built_in',
        walletPublicKey: action.publicKey,
        builtInWalletStatus: 'unlocked',
      };
    case 'wallet/lockedBuiltIn':
      return {
        ...state,
        builtInWalletStatus: state.walletMode === 'built_in' ? 'locked' : state.builtInWalletStatus,
      };
    case 'wallet/reset':
      return {
        ...state,
        walletMode: null,
        walletPublicKey: null,
        builtInWalletStatus: 'none',
      };
    case 'settings/setTreasuryAddress':
      return {
        ...state,
        treasuryAddress: action.treasuryAddress,
      };
    case 'settings/setFeeTokenMint':
      return {
        ...state,
        feeTokenMint: action.feeTokenMint,
      };
    case 'settings/toggleSeekerDiscount':
      return {
        ...state,
        seekerDiscountEnabled: !state.seekerDiscountEnabled,
      };
    case 'settings/setSolanaMobileOwner':
      return {
        ...state,
        solanaMobileOwner: action.value,
      };
    case 'settings/setNetwork':
      return {
        ...state,
        network: action.network,
      };
    case 'sendConfig/setBatchSize': {
      const next = Math.max(1, Math.min(20, Math.floor(action.batchSize)));
      return {
        ...state,
        sendConfig: {
          ...state.sendConfig,
          batchSize: next,
        },
      };
    }
    case 'sendConfig/setAmountMode':
      return {
        ...state,
        sendConfig: {
          ...state.sendConfig,
          amountMode: action.mode,
        },
      };
    case 'sendConfig/setEqualAmount':
      return {
        ...state,
        sendConfig: {
          ...state.sendConfig,
          equalAmountUi: action.amountUi,
        },
      };
    case 'sendConfig/setEqualNftCount':
      return {
        ...state,
        sendConfig: {
          ...state.sendConfig,
          equalNftCount: Math.max(1, Math.floor(action.count)),
        },
      };
    case 'sendConfig/toggleCreateAta':
      return {
        ...state,
        sendConfig: {
          ...state.sendConfig,
          createRecipientAtaIfMissing: !state.sendConfig.createRecipientAtaIfMissing,
        },
      };
    case 'giveaway/enable':
      return {
        ...state,
        giveawayConfig: { ...state.giveawayConfig, enabled: true },
      };
    case 'giveaway/disable':
      return {
        ...state,
        giveawayConfig: { ...state.giveawayConfig, enabled: false, selectedRecipientIds: [] },
      };
    case 'giveaway/setWinnerCount':
      return {
        ...state,
        giveawayConfig: { ...state.giveawayConfig, winnerCount: Math.max(1, Math.floor(action.count)) },
      };
    case 'giveaway/setSelectedRecipients':
      return {
        ...state,
        giveawayConfig: { ...state.giveawayConfig, selectedRecipientIds: action.ids },
      };
    case 'recipients/setAll': {
      const all = dedupeAndValidate(action.recipients).all;
      return { ...state, recipients: all };
    }
    case 'recipients/clear':
      return { ...state, recipients: [] };
    case 'recipients/removeByIds': {
      const next = state.recipients.filter((r) => !action.ids.includes(r.id));
      const all = dedupeAndValidate(next).all;
      return { ...state, recipients: all };
    }
    case 'recipients/update': {
      const next = state.recipients.map((r) => 
        r.id === action.id 
          ? { ...r, address: action.address, amount: action.amount } 
          : r
      );
      const all = dedupeAndValidate(next).all;
      return { ...state, recipients: all };
    }
    case 'recipients/cleanInvalid': {
      const next = state.recipients.filter((r) => r.error !== 'invalid_address');
      const all = dedupeAndValidate(next).all;
      return { ...state, recipients: all };
    }
    case 'recipients/cleanDuplicates': {
      const next = state.recipients.filter((r) => r.error !== 'duplicate');
      const all = dedupeAndValidate(next).all;
      return { ...state, recipients: all };
    }
    case 'asset/setSelected':
      return { ...state, selectedAsset: action.asset };
    case 'asset/setBalance':
      return { ...state, assetBalance: action.balance };
    case 'asset/clear':
      return { ...state, selectedAsset: null, assetBalance: null };
    case 'fee/setQuote':
      return { ...state, feeQuote: action.quote };
    case 'fee/clear':
      return { ...state, feeQuote: null };
    case 'promo/armLaunchBlastFreeFee':
      return { ...state, launchBlastFreeFeeAvailable: true };
    case 'promo/consumeLaunchBlastFreeFee':
      return { ...state, launchBlastFreeFeeAvailable: false };
    default: {
      const exhaustive: never = action;
      return state;
    }
  }
}
