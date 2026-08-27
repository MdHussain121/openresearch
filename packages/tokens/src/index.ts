/**
 * OpenResearch Design Tokens
 * Exported constants for TypeScript components and Tailwind integration
 */

export const colors = {
  light: {
    bgCanvas: '#FAFAF9',
    bgSurface: '#FFFFFF',
    bgSunken: '#F1F0EE',
    textPrimary: '#1A1A18',
    textSecondary: '#5C5B57',
    textTertiary: '#8A8985',
    borderDefault: '#E4E2DE',
    accentPrimary: '#2C5F4A',
    accentPrimaryHover: '#234B3B',
    sourceGrounded: '#2C5F4A',
    aiInference: '#8A5A2B',
    generalKnowledge: '#5C5B57',
    warning: '#B4522A',
    danger: '#B33A3A',
    success: '#3A7D5C',
  },
  dark: {
    bgCanvas: '#17171A',
    bgSurface: '#1E1E22',
    bgSunken: '#131315',
    textPrimary: '#EDECE9',
    textSecondary: '#A6A4A0',
    textTertiary: '#6E6D68',
    borderDefault: '#2C2C30',
    accentPrimary: '#5FA98A',
    accentPrimaryHover: '#72BCA0',
    sourceGrounded: '#5FA98A',
    aiInference: '#C99A5F',
    generalKnowledge: '#A6A4A0',
    warning: '#E08558',
    danger: '#E06666',
    success: '#6BC79A',
  },
} as const;

export const typography = {
  fontSizes: {
    xs: '12px',
    sm: '14px',
    base: '16px',
    editorBody: '17px',
    lg: '20px',
    xl: '24px',
    '2xl': '32px',
  },
  fontFamily: {
    sans: 'Inter, system-ui, -apple-system, sans-serif',
    serif: '"Source Serif 4", Georgia, Cambria, "Times New Roman", serif',
    mono: '"JetBrains Mono", Menlo, Monaco, Consolas, monospace',
  },
  lineHeight: {
    editorBody: '1.6',
  },
} as const;

export const layout = {
  topbarHeight: '48px',
  sidebarWidth: '220px',
  sidebarCollapsedWidth: '56px',
  editorMaxWidth: '720px',
  sourcePanelWidth: '320px',
  sourcePanelCollapsedWidth: '32px',
} as const;

export const density = {
  comfortable: {
    padding: '16px',
    listRhythm: '12px',
  },
  compact: {
    padding: '8px',
    listRhythm: '8px',
  },
} as const;
