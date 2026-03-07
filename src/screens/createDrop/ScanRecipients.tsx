import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, Vibration, ScrollView } from 'react-native';
import { CameraView, Camera, BarcodeScanningResult } from 'expo-camera';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { PublicKey } from '@solana/web3.js';

import type { CreateDropStackParamList } from '../../navigation/types';
import { Button, Chip, Screen } from '../../components/ui';
import { useApp } from '../../state/context';
import { spacing, typography, useTheme } from '../../theme';
import { normalizeAddress } from '../../utils/recipients';
import type { Recipient } from '../../types/recipient';

type Props = NativeStackScreenProps<CreateDropStackParamList, 'ScanRecipients'>;

type ScannedItem = {
  address: string;
  status: 'valid' | 'duplicate' | 'invalid';
  timestamp: number;
};

export function ScanRecipients({ navigation }: Props) {
  const { state, dispatch } = useApp();
  const { colors } = useTheme();
  
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [multiScan, setMultiScan] = useState(true);
  const [isScanning, setIsScanning] = useState(true);
  
  // Ref for throttling
  const lastScannedRef = useRef<{ value: string; time: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const existingAddresses = useMemo(() => {
    return new Set(state.recipients.map(r => r.address));
  }, [state.recipients]);

  const onBarcodeScanned = (scanningResult: BarcodeScanningResult) => {
    if (!isScanning) return;

    const rawValue = scanningResult.data;
    const now = Date.now();

    // Throttle: prevent scanning same code within 2 seconds
    if (
      lastScannedRef.current &&
      lastScannedRef.current.value === rawValue &&
      now - lastScannedRef.current.time < 2000
    ) {
      return;
    }

    lastScannedRef.current = { value: rawValue, time: now };

    // Parse logic
    let address = rawValue;
    // Strip prefixes like "solana:" or "phantom:"
    if (address.includes(':')) {
      const parts = address.split(':');
      if (parts.length > 1) {
        address = parts[1];
      }
    }
    // Strip query params if any
    if (address.includes('?')) {
      address = address.split('?')[0];
    }

    const normalized = normalizeAddress(address);
    let status: ScannedItem['status'] = 'invalid';

    if (normalized) {
      // Check duplicate in global state
      if (existingAddresses.has(normalized)) {
        status = 'duplicate';
      } 
      // Check duplicate in current session
      else if (scannedItems.some(item => item.address === normalized)) {
        status = 'duplicate';
      } 
      else {
        status = 'valid';
      }
    }

    // Feedback
    if (status === 'valid') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (status === 'duplicate') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    // Add to list
    if (status === 'valid') {
        setScannedItems(prev => [{ address: normalized!, status, timestamp: now }, ...prev]);
    } else if (status === 'duplicate') {
        // Optional: show toast or just ignore if already scanned
        // For UX, maybe just vibrate warning and don't add to list if it's already in list?
        // But if it's duplicate in GLOBAL list, we might want to show it as "Duplicate"
        if (normalized) {
             setScannedItems(prev => [{ address: normalized, status, timestamp: now }, ...prev]);
        }
    }

    if (!multiScan && status === 'valid') {
      setIsScanning(false);
      // Auto-finish after short delay? Or let user click Done.
      // Let's just stop scanning.
    }
  };

  const onDone = () => {
    // Filter valid items
    const validNew = scannedItems.filter(item => item.status === 'valid');
    if (validNew.length > 0) {
      // Add to global state
      const recipients: Recipient[] = validNew.map((item, index) => ({
        id: `qr-${Date.now()}-${index}`,
        address: item.address,
        source: 'qr',
        isValid: true,
      }));
      dispatch({ type: 'recipients/setAll', recipients: [...state.recipients, ...recipients] });
    }
    navigation.goBack();
  };

  const onUndoLast = () => {
    setScannedItems(prev => prev.slice(1));
  };

  const onClear = () => {
    setScannedItems([]);
  };

  if (hasPermission === null) {
    return <View style={styles.container}><Text style={{color: colors.text}}>Requesting permission...</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.container}><Text style={{color: colors.text}}>No access to camera</Text></View>;
  }

  const validCount = scannedItems.filter(i => i.status === 'valid').length;
  const duplicateCount = scannedItems.filter(i => i.status === 'duplicate').length;

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        onBarcodeScanned={isScanning ? onBarcodeScanned : undefined}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
      />
      
      {/* Overlay UI */}
      <View style={styles.overlay}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <Button title="Cancel" onPress={() => navigation.goBack()} variant="secondary" style={styles.topBtn} />
          <View style={styles.pillContainer}>
             <Chip 
               label={multiScan ? "Multi-Scan: ON" : "Multi-Scan: OFF"} 
               selected={multiScan} 
               onPress={() => setMultiScan(!multiScan)} 
             />
          </View>
          <Button title="Done" onPress={onDone} variant="primary" style={styles.topBtn} />
        </View>

        {/* Center Target Marker (Optional visual aid) */}
        <View style={styles.centerMarkerContainer}>
           <View style={[styles.centerMarker, { borderColor: isScanning ? colors.primary : colors.textSecondary }]} />
        </View>

        {/* Bottom Panel */}
        <View style={[styles.bottomPanel, { backgroundColor: colors.surface }]}>
           <View style={styles.statsRow}>
              <Text style={[styles.statText, { color: colors.text }]}>Scanned: {scannedItems.length}</Text>
              <Text style={[styles.statText, { color: colors.success }]}>Valid: {validCount}</Text>
              <Text style={[styles.statText, { color: colors.warningText }]}>Dupes: {duplicateCount}</Text>
           </View>

           <View style={styles.actionsRow}>
              <Button title="Undo" onPress={onUndoLast} variant="secondary" disabled={scannedItems.length === 0} style={{flex:1}} />
              <Button title="Clear" onPress={onClear} variant="outline" disabled={scannedItems.length === 0} style={{flex:1}} />
           </View>

           <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Recent Scans</Text>
           <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
              {scannedItems.slice(0, 10).map((item, i) => (
                 <View key={i} style={[styles.listItem, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.addr, { color: colors.text }]}>
                      {item.address.slice(0, 4)}...{item.address.slice(-4)}
                    </Text>
                    <Text style={[
                      styles.status, 
                      { color: item.status === 'valid' ? colors.success : item.status === 'duplicate' ? colors.warningText : colors.danger }
                    ]}>
                      {item.status.toUpperCase()}
                    </Text>
                 </View>
              ))}
           </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 50,
    paddingHorizontal: 20,
  },
  topBtn: {
    minWidth: 70,
    height: 36,
  },
  pillContainer: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  centerMarkerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerMarker: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  bottomPanel: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    height: '40%',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  statText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  list: {
    flex: 1,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  addr: {
    fontSize: 14,
    fontFamily: 'monospace',
  },
  status: {
    fontSize: 12,
    fontWeight: 'bold',
  },
});
