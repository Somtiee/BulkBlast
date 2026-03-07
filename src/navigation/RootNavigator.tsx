import React, { useMemo } from 'react';
import { NavigationContainer, DefaultTheme, Theme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';

import type { AuthStackParamList, CreateDropStackParamList, MainTabsParamList, RootStackParamList } from './types';
import { AppHeader } from '../components/ui';
import { useTheme } from '../theme';
import { Welcome } from '../screens/auth/Welcome';
import { WalletSetup } from '../screens/auth/WalletSetup';
import { CreateOrImportWallet } from '../screens/auth/CreateOrImportWallet';
import { ImportPrivateKey } from '../screens/auth/ImportPrivateKey';
import { CreateDrop } from '../screens/createDrop/CreateDrop';
import { AssetSelect } from '../screens/createDrop/AssetSelect';
import { ScanRecipients } from '../screens/createDrop/ScanRecipients';
import { Review } from '../screens/createDrop/Review';
import { ExecuteProgress } from '../screens/createDrop/ExecuteProgress';
import { SwapModal } from '../screens/createDrop/SwapModal';
import { ReceiptDetails } from '../screens/history/ReceiptDetails';
import { History } from '../screens/history/History';
import { Settings } from '../screens/settings/Settings';
import { useApp } from '../state/context';
import { ActivityIndicator, View } from 'react-native';

const Root = createNativeStackNavigator<RootStackParamList>();
const Auth = createNativeStackNavigator<AuthStackParamList>();
const CreateDropStack = createNativeStackNavigator<CreateDropStackParamList>();
const Tabs = createBottomTabNavigator<MainTabsParamList>();

function screenHeader(title: string): NativeStackNavigationOptions {
  return {
    header: ({ navigation, back }) => (
      <AppHeader title={title} canGoBack={!!back} onBack={navigation.goBack} />
    ),
  };
}

function AuthStackNavigator() {
  return (
    <Auth.Navigator screenOptions={{ headerShown: true }}>
      <Auth.Screen name="Welcome" component={Welcome} options={screenHeader('Welcome')} />
      <Auth.Screen name="WalletSetup" component={WalletSetup} options={screenHeader('Wallet Setup')} />
      <Auth.Screen
        name="CreateOrImportWallet"
        component={CreateOrImportWallet}
        options={screenHeader('Built-in Wallet')}
      />
      <Auth.Screen name="ImportPrivateKey" component={ImportPrivateKey} options={screenHeader('Import Private Key')} />
    </Auth.Navigator>
  );
}

function CreateDropStackNavigator() {
  return (
    <CreateDropStack.Navigator>
      <CreateDropStack.Screen name="CreateDrop" component={CreateDrop} options={screenHeader('Create Drop')} />
      <CreateDropStack.Screen name="AssetSelect" component={AssetSelect} options={screenHeader('Select Asset')} />
      <CreateDropStack.Screen name="ScanRecipients" component={ScanRecipients} options={{ headerShown: false }} />
      <CreateDropStack.Screen name="Review" component={Review} options={screenHeader('Review')} />
      <CreateDropStack.Screen
        name="ExecuteProgress"
        component={ExecuteProgress}
        options={screenHeader('Executing')}
      />
      <CreateDropStack.Screen name="SwapModal" component={SwapModal} options={screenHeader('Swap')} />
      <CreateDropStack.Screen name="ReceiptDetails" component={ReceiptDetails} options={screenHeader('Receipt')}/>
    </CreateDropStack.Navigator>
  );
}

function MainTabsNavigator() {
  const { colors } = useTheme();
  
  return (
    <Tabs.Navigator 
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 85, // Increased height for better spacing
          paddingBottom: 25, // Increased padding to move icons up from system bar
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
          marginTop: -5,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarIcon: ({ focused, color, size }) => {
          let icon = '📦';
          if (route.name === 'CreateDropStack') {
            icon = '🚀';
          } else if (route.name === 'History') {
            icon = '📜';
          } else if (route.name === 'Settings') {
            icon = '⚙️';
          }
          return <Text style={{ fontSize: 20 }}>{icon}</Text>;
        },
      })}
    >
      <Tabs.Screen
        name="CreateDropStack"
        component={CreateDropStackNavigator}
        options={{ tabBarLabel: 'Create' }}
      />
      <Tabs.Screen
        name="History"
        component={History}
        options={{ tabBarLabel: 'History' }}
      />
      <Tabs.Screen
        name="Settings"
        component={Settings}
        options={{ tabBarLabel: 'Settings' }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const { state } = useApp();
  const { colors, isDark } = useTheme();
  const isAuthenticated = !!state.walletPublicKey;

  const navigationTheme = useMemo(() => {
    const baseTheme = isDark ? DarkTheme : DefaultTheme;
    return {
      ...baseTheme,
      colors: {
        ...baseTheme.colors,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
        notification: colors.danger,
      },
    };
  }, [colors, isDark]);

  return (
    <NavigationContainer theme={navigationTheme}>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <Root.Screen name="Main" component={MainTabsNavigator} />
        ) : (
          <Root.Screen name="Auth" component={AuthStackNavigator} />
        )}
      </Root.Navigator>
    </NavigationContainer>
  );
}
