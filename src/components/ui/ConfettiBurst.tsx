import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useTheme } from '../../theme';

type Piece = {
  id: string;
  color: string;
  size: number;
  x0: number;
  x1: number;
  y: number;
  rotate: string;
  delayMs: number;
  durationMs: number;
};

// Lightweight confetti (no external deps).
export function ConfettiBurst({ density = 36 }: { density?: number }) {
  const { colors } = useTheme();

  const colorsPalette = useMemo(
    () => [
      colors.primary,
      colors.success,
      colors.warning,
      '#F43F5E',
      '#3B82F6',
      '#A855F7',
      '#F59E0B',
      '#06B6D4',
    ],
    [colors.primary, colors.success, colors.warning]
  );

  const pieces: Piece[] = useMemo(() => {
    // Deterministic enough for a single burst.
    return Array.from({ length: density }).map((_, i) => {
      const rand = (min: number, max: number) => min + Math.random() * (max - min);
      const x0 = rand(-40, 40);
      const x1 = x0 + rand(-20, 20);
      const y = rand(140, 260);
      const size = rand(6, 10);
      const rotateDeg = rand(200, 620);
      return {
        id: `p${i}`,
        color: colorsPalette[i % colorsPalette.length],
        size,
        x0,
        x1,
        y,
        rotate: `${rotateDeg}deg`,
        delayMs: Math.round(rand(0, 220)),
        durationMs: Math.round(rand(700, 1100)),
      };
    });
  }, [density, colorsPalette]);

  const animsRef = useRef<Record<string, Animated.Value>>({});
  if (!animsRef.current || Object.keys(animsRef.current).length === 0) {
    pieces.forEach((p) => {
      animsRef.current[p.id] = new Animated.Value(0);
    });
  }

  useEffect(() => {
    pieces.forEach((p) => {
      const anim = animsRef.current[p.id];
      anim?.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: p.durationMs,
        delay: p.delayMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    // No cleanup necessary; component unmounts when parent closes.
  }, [pieces]);

  return (
    <View pointerEvents="none" style={styles.container}>
      {pieces.map((p) => {
        const anim = animsRef.current[p.id];
        const translateX = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [p.x0, p.x1],
        });
        const translateY = anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, p.y],
        });
        const rotate = anim.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', p.rotate],
        });

        return (
          <Animated.View
            key={p.id}
            style={[
              styles.piece,
              {
                width: p.size,
                height: p.size * 0.55,
                backgroundColor: p.color,
                transform: [{ translateX }, { translateY }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: '50%',
    top: 0,
    width: 1,
    height: 300,
    zIndex: 2,
    // Confetti origin.
    transform: [{ translateX: -0.5 }],
  },
  piece: {
    position: 'absolute',
    borderRadius: 2,
    opacity: 0.95,
  },
});

