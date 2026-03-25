const common = {
  primary: '#2563EB',
  primaryPressed: '#1D4ED8',
  danger: '#DC2626',
  success: '#16A34A',
  warning: '#D97706',
  warningBackground: '#FFF4E5',
  warningBorder: '#FFCC80',
  warningText: '#663C00',
};

export const lightColors = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  surface2: '#F0F2F5',
  text: '#0F172A',
  textSecondary: '#475569',
  /** Hints / input placeholders — lower contrast than labels */
  textPlaceholder: '#94a3b8',
  border: '#E2E8F0',
  ...common,
} as const;

export const darkColors = {
  background: '#0F172A', // Slate 900
  surface: '#1E293B', // Slate 800
  surface2: '#334155', // Slate 700
  text: '#e6fffa', // Light Mint/Cyan for high contrast
  textSecondary: '#99f6e4', // Teal 200 for secondary text
  /** Placeholders — muted so fields don’t compete with labels */
  textPlaceholder: '#4b635e',
  border: '#334155', // Slate 700
  ...common,
} as const;

// Default export for backward compatibility
export const colors: Colors = lightColors;

export type Colors = { [K in keyof typeof lightColors]: string };
