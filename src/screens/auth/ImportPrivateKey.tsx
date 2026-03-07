import React, { useMemo, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { AuthStackParamList } from '../../navigation/types';
import { Button, Card, Input, Screen } from '../../components/ui';
import { useApp } from '../../state/context';
import { importAnyWallet } from '../../services/WalletService';
import { spacing, typography, useTheme } from '../../theme';
import { StorageService, KEYS } from '../../services/StorageService';

type Props = NativeStackScreenProps<AuthStackParamList, 'ImportPrivateKey'>;

export function ImportPrivateKey({}: Props) {
  const { dispatch } = useApp();
  const { colors } = useTheme();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [isHidden, setIsHidden] = useState(true);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        warningBox: {
          backgroundColor: colors.warningBackground,
          padding: spacing[3],
          borderRadius: 8,
          marginBottom: spacing[4],
          borderWidth: 1,
          borderColor: colors.warningBorder,
        },
        warningText: {
          color: colors.warningText,
          fontSize: typography.fontSize.bodySmall,
        },
        labelRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing[2],
        },
        label: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.bodySmall,
          fontWeight: typography.weight.medium,
        },
        toggleText: {
          color: colors.primary,
          fontSize: typography.fontSize.bodySmall,
          fontWeight: typography.weight.medium,
        },
        submit: {
          marginTop: spacing[4],
        },
      }),
    [colors]
  );

  async function onSubmit() {
    setError(undefined);
    // Remove all whitespace to handle multiline pastes safely
    const cleanInput = input.replace(/\s/g, '');
    
    if (!cleanInput) {
      setError('Please enter your private key');
      return;
    }
    
    setLoading(true);
    try {
      const res = await importAnyWallet(cleanInput);
      await StorageService.setItem(KEYS.WALLET_LOCKED, 'false');
      dispatch({ type: 'wallet/importedBuiltIn', publicKey: res.publicKey });
    } catch (e: any) {
      setError(e.message || 'Failed to import wallet');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen title="Import Private Key">
      <Card>
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            ⚠️ SECURITY WARNING: Never share your private key. We encrypt it locally on your device.
          </Text>
        </View>

        <View style={styles.labelRow}>
          <Text style={styles.label}>Private Key (Base58 or JSON Array)</Text>
          <TouchableOpacity onPress={() => setIsHidden(!isHidden)}>
             <Text style={styles.toggleText}>{isHidden ? 'Show' : 'Hide'}</Text>
          </TouchableOpacity>
        </View>

        <Input 
          value={input} 
          onChangeText={setInput} 
          placeholder="e.g. 5M... or [1, 2, 3...]" 
          errorText={error}
          multiline={!isHidden}
          numberOfLines={isHidden ? 1 : 4}
          secureTextEntry={isHidden}
          inputStyle={{ height: isHidden ? 50 : 100 }}
        />
        
        <Button title="Import Wallet" onPress={onSubmit} loading={loading} style={styles.submit} />
      </Card>
    </Screen>
  );
}
