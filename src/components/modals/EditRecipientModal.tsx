import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { Button, Input } from '../ui';
import { spacing, useTheme } from '../../theme';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSave: (address: string, amount: string) => void;
  initialAddress: string;
  initialAmount?: string;
};

export function EditRecipientModal({ visible, onClose, onSave, initialAddress, initialAmount }: Props) {
  const { colors } = useTheme();
  const [address, setAddress] = useState(initialAddress);
  const [amount, setAmount] = useState(initialAmount || '');

  useEffect(() => {
    if (visible) {
      setAddress(initialAddress);
      setAmount(initialAmount || '');
    }
  }, [visible, initialAddress, initialAmount]);

  function handleSave() {
    onSave(address, amount);
    onClose();
  }

  const styles = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: spacing[4],
    },
    content: {
      backgroundColor: colors.background,
      borderRadius: 16,
      padding: spacing[4],
      gap: spacing[4],
      borderWidth: 1,
      borderColor: colors.border,
    },
    header: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
    },
    actions: {
      flexDirection: 'row',
      gap: spacing[3],
      marginTop: spacing[2],
    },
    btn: {
      flex: 1,
    },
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <Text style={styles.header}>Edit Recipient</Text>
          
          <Input
            label="Wallet Address"
            value={address}
            onChangeText={setAddress}
            placeholder="Enter address"
          />
          
          <Input
            label="Amount (Optional)"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.0"
            keyboardType="numeric"
          />

          <View style={styles.actions}>
            <Button title="Cancel" onPress={onClose} variant="secondary" style={styles.btn} />
            <Button title="Save" onPress={handleSave} variant="primary" style={styles.btn} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
