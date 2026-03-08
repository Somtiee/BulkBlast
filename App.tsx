import './src/polyfill';
import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider } from './src/state/context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { AppBootSplash } from './src/components/AppBootSplash';
import { useBootSplash } from './src/hooks/useBootSplash';
import { AppHydrator } from './src/components/AppHydrator';
import { ThemeProvider } from './src/theme';
import { ErrorBoundary } from './src/components/ErrorBoundary';

export default function App() {
  const { isVisible, hideSplash } = useBootSplash();

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppProvider>
            <AppHydrator onReady={hideSplash}>
              <RootNavigator />
            </AppHydrator>
            {isVisible && <AppBootSplash visible={isVisible} onDismiss={() => {}} />}
            <StatusBar style="auto" />
          </AppProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
