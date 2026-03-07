import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Image, Animated, useColorScheme } from 'react-native';

const LOGO_LIGHT = require('../../assets/logo-light.png');
const LOGO_LIGHT_2 = require('../../assets/logo-light2.png');
const LOGO_DARK = require('../../assets/logo-dark.png');
const LOGO_DARK_2 = require('../../assets/logo-dark2.png');

type Props = {
  onDismiss: () => void;
  visible: boolean;
};

export function AppBootSplash({ onDismiss, visible }: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const logo1 = isDark ? LOGO_DARK : LOGO_LIGHT;
  const logo2 = isDark ? LOGO_DARK_2 : LOGO_LIGHT_2;
  const backgroundColor = isDark ? '#0F172A' : '#F6F7F9'; // Match theme background colors

  const fadeAnim1 = useRef(new Animated.Value(0)).current;
  const fadeAnim2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Sequence:
      // 1. Fade in Logo 1
      // 2. Wait
      // 3. Fade out Logo 1
      // 4. Fade in Logo 2
      // 5. Wait
      // 6. Dismiss
      
      Animated.sequence([
        // Step 1: Fade in first logo
        Animated.timing(fadeAnim1, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        // Hold for a moment
        Animated.delay(1000),
        // Step 2: Crossfade - Fade out Logo 1, Fade in Logo 2
        Animated.parallel([
          Animated.timing(fadeAnim1, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(fadeAnim2, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
        // Hold second logo
        Animated.delay(1200),
        // Step 3: Fade out everything (optional, or just dismiss)
        Animated.timing(fadeAnim2, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        })
      ]).start(() => {
         onDismiss();
      });
    }
  }, [visible, fadeAnim1, fadeAnim2, onDismiss]);

  if (!visible) return null;

  return (
    <View style={[styles.container, { backgroundColor, zIndex: 9999 }]}>
       {/* Logo 1 */}
       <Animated.View style={[styles.logoContainer, { opacity: fadeAnim1 }]}>
          <Image source={logo1} style={styles.logo} resizeMode="contain" />
       </Animated.View>

       {/* Logo 2 */}
       <Animated.View style={[styles.logoContainer, { opacity: fadeAnim2 }]}>
          <Image source={logo2} style={styles.logo} resizeMode="contain" />
       </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 240,
    height: 240,
  },
});
