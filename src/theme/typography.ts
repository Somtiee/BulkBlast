import type { TextStyle } from 'react-native';

export const typography = {
  fontSize: {
    display: 28,
    title: 20,
    subhead: 18,
    body: 16,
    bodySmall: 14,
    caption: 12,
  },
  lineHeight: {
    display: 34,
    title: 26,
    subhead: 24,
    body: 22,
    bodySmall: 20,
    caption: 16,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  } satisfies Record<string, TextStyle['fontWeight']>,
} as const;

export type Typography = typeof typography;
