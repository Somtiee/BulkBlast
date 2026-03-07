import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { AuthStackParamList } from '../../navigation/types';
import { Screen, Card } from '../../components/ui';
import { spacing, typography, useTheme } from '../../theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'WalletSetup'>;

export function WalletSetup({}: Props) {
  const { colors } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        text: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.body,
          lineHeight: typography.lineHeight.body,
        },
      }),
    [colors]
  );

  return (
    <Screen title="Wallet Setup" subtitle="Choose how you want to use a wallet">
      <Card>
        <Text style={styles.text}>You can connect a mobile wallet or use the built-in wallet.</Text>
      </Card>
    </Screen>
  );
}
