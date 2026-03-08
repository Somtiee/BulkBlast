import React, { useMemo } from 'react';
import { Alert, View, StyleSheet, Image, Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { AuthStackParamList } from '../../navigation/types';
import { Button, Card, Screen } from '../../components/ui';
import { useApp } from '../../state/context';
import { connectAdapter } from '../../services/WalletService';
import { spacing, typography, useTheme } from '../../theme';

const LOGO_DARK = require('../../../assets/logo-dark.png');
const LOGO_LIGHT = require('../../../assets/logo-light.png');

type Props = NativeStackScreenProps<AuthStackParamList, 'Welcome'>;

export function Welcome({ navigation }: Props) {
  const { dispatch } = useApp();
  const { colors, isDark } = useTheme();
  const logoSource = isDark ? LOGO_DARK : LOGO_LIGHT;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        header: {
          alignItems: 'center',
          marginBottom: spacing[6],
          gap: spacing[2],
        },
        logo: {
          width: 200,
          height: 60,
        },
        subtitle: {
          color: colors.textSecondary,
          fontSize: typography.fontSize.body,
          textAlign: 'center',
        },
        ctaRow: {
          gap: spacing[4],
        },
        cta: {
          flexGrow: 1,
        },
      }),
    [colors]
  );

  function onUseBuiltIn() {
    navigation.navigate('CreateOrImportWallet');
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Image source={logoSource} style={styles.logo} resizeMode="contain" />
        <Text style={styles.subtitle}>Professional, Bulk transaction/airdrop tool</Text>
      </View>
      
      <Card>
        <View style={styles.ctaRow}>
          <Button title="LAUNCH APP" onPress={onUseBuiltIn} variant="primary" style={styles.cta} />
        </View>
      </Card>
    </Screen>
  );
}
