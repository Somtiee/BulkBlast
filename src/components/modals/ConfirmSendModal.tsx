import React, { useState } from 'react';
import { Modal, StyleSheet, Text, View, ScrollView } from 'react-native';
import { Button, Card, Divider, Row, Input } from '../ui';
import { spacing, typography, useTheme } from '../../theme';
import type { SelectedAsset } from '../../types/asset';
import type { FeeQuote } from '../../state/types';

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  recipientsCount: number;
  totalAmountUi: string;
  asset: SelectedAsset | null;
  batchesCount: number;
  feeQuote: FeeQuote | null;
};

export function ConfirmSendModal({
  visible,
  onClose,
  onConfirm,
  recipientsCount,
  totalAmountUi,
  asset,
  batchesCount,
  feeQuote,
}: Props) {
  const { colors } = useTheme();
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState('');

  const isConfirmed = confirmText === 'BLAST';

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.8)',
      justifyContent: 'center',
      padding: spacing[4],
    },
    container: {
      backgroundColor: colors.background,
      borderRadius: 16,
      padding: spacing[4],
      maxHeight: '90%',
    },
    header: {
      fontSize: typography.fontSize.title,
      fontWeight: typography.weight.bold,
      color: colors.text,
      textAlign: 'center',
      marginBottom: spacing[4],
    },
    warningBox: {
      backgroundColor: '#FEF2F2',
      borderColor: '#FCA5A5',
      borderWidth: 1,
      borderRadius: 8,
      padding: spacing[3],
      marginVertical: spacing[4],
    },
    warningText: {
      color: '#B91C1C',
      fontSize: typography.fontSize.body,
      fontWeight: typography.weight.semibold,
      textAlign: 'center',
    },
    stepText: {
      fontSize: typography.fontSize.caption,
      color: colors.textSecondary,
      marginBottom: spacing[2],
      textAlign: 'center',
    },
  });

  const handleClose = () => {
    setStep(1);
    setConfirmText('');
    onClose();
  };

  const handleConfirm = () => {
    if (step === 1) {
      setStep(2);
    } else {
      if (isConfirmed) {
        onConfirm();
      }
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.header}>
            {step === 1 ? 'Confirm Transaction' : 'Final Authorization'}
          </Text>
          
          <Text style={styles.stepText}>Step {step} of 2</Text>

          <ScrollView contentContainerStyle={{ gap: spacing[3] }}>
            {step === 1 ? (
              <>
                <Card>
                  <Row label="Recipients" value={recipientsCount.toString()} />
                  <Row 
                    label="Asset" 
                    value={
                      asset?.kind === 'SPL' ? (asset.symbol || 'SPL') : 
                      asset?.kind === 'NFT' ? (asset.symbol || 'NFT Collection') : 
                      'SOL'
                    } 
                  />
                  <Row 
                    label="Total Amount" 
                    value={`${totalAmountUi} ${
                      asset?.kind === 'SPL' ? (asset.symbol || '') : 
                      asset?.kind === 'NFT' ? 'Items' : 
                      'SOL'
                    }`} 
                    valueStyle={{ fontWeight: 'bold' }}
                  />
                  <Row label="Batches" value={batchesCount.toString()} />
                  {feeQuote && (
                    <Row 
                      label="Fee" 
                      value={`${feeQuote.feeTokens} SEEKER`} 
                      valueStyle={{ color: colors.primary }}
                    />
                  )}
                </Card>

                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>
                    Please review all details carefully. Transactions cannot be undone.
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>
                    ⚠️ IRREVERSIBLE ACTION
                  </Text>
                  <Text style={[styles.warningText, { marginTop: 4, fontWeight: 'normal' }]}>
                    Once sent, funds cannot be recovered.
                  </Text>
                </View>

                <Text style={{ color: colors.text, marginBottom: spacing[2] }}>
                  Type "BLAST" below to confirm:
                </Text>
                
                <Input
                  value={confirmText}
                  onChangeText={setConfirmText}
                  placeholder="BLAST"
                  autoCapitalize="characters"
                  style={{ marginBottom: spacing[4] }}
                />
              </>
            )}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: spacing[3], marginTop: spacing[4] }}>
            <Button 
              title="Cancel" 
              onPress={handleClose} 
              variant="secondary" 
              style={{ flex: 1 }} 
            />
            <Button 
              title={step === 1 ? "I Understand, Continue" : "Send Now"} 
              onPress={handleConfirm} 
              variant={step === 1 ? "primary" : "primary"} // Use primary for both, maybe danger for step 2?
              style={{ flex: 1, backgroundColor: step === 2 ? colors.danger : undefined }}
              disabled={step === 2 && !isConfirmed}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
