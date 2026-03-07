import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, Colors } from './colors';
import { StorageService, KEYS } from '../services/StorageService';

export type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextType = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  colors: Colors;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeContextType>({
  mode: 'system',
  setMode: () => {},
  colors: lightColors,
  isDark: false,
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>('system');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    StorageService.getItem(KEYS.THEME_MODE).then((val) => {
      if (val && (val === 'light' || val === 'dark' || val === 'system')) {
        setMode(val as ThemeMode);
      }
      setIsReady(true);
    });
  }, []);

  const saveMode = (newMode: ThemeMode) => {
    setMode(newMode);
    StorageService.setItem(KEYS.THEME_MODE, newMode);
  };

  const activeScheme = mode === 'system' ? (systemScheme || 'light') : mode;
  const isDark = activeScheme === 'dark';
  const colors = isDark ? darkColors : lightColors;

  if (!isReady) return null;

  return (
    <ThemeContext.Provider value={{ mode, setMode: saveMode, colors, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
