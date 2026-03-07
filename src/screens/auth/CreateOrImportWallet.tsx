import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { AuthStackParamList } from '../../navigation/types';
import { Button, Card, Screen } from '../../components/ui';
import { createBuiltIn } from '../../services/WalletService';
import { useApp } from '../../state/context';
import { spacing, useTheme } from '../../theme';
import { StorageService, KEYS } from '../../services/StorageService';

type Props = NativeStackScreenProps<AuthStackParamList, 'CreateOrImportWallet'>;

export function CreateOrImportWallet({ navigation }: Props) {
  const { dispatch } = useApp();
  const { colors } = useTheme();

  async function onCreate() {
    const res = await createBuiltIn();
    await StorageService.setItem(KEYS.WALLET_LOCKED, 'false');
    dispatch({ type: 'wallet/createdBuiltIn', publicKey: res.publicKey });
  }

  function onImport() {
    navigation.navigate('ImportPrivateKey');
  }

  return (
    <Screen title="Built-in Wallet" subtitle="Get started with BulkBlast">
      <View style={{ alignItems: 'center', marginVertical: 32 }}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
           <Text style={{ fontSize: 40 }}>🛡️</Text>
        </View>
        <Text style={{ fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: 8 }}>Secure Wallet</Text>
        <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center', maxWidth: 300 }}>
          Your keys are encrypted locally on your device. We never see your private key.
        </Text>
      </View>

      <Card>
        <View style={styles.ctaRow}>
          <Button title="Create New Wallet" onPress={onCreate} variant="primary" style={{ minHeight: 56 }} />
          
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
             <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
             <Text style={{ color: colors.textSecondary, fontSize: 12 }}>OR</Text>
             <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>

          <Button title="Import Private Key" onPress={onImport} variant="secondary" style={{ minHeight: 56 }} />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  ctaRow: {
    gap: spacing[4],
  },
});
