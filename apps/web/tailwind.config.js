/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    '../../packages/*/src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        surface: 'var(--bg-surface)',
        sunken: 'var(--bg-sunken)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        primary: 'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        tertiary: 'var(--text-tertiary)',
        'border-default': 'var(--border-default)',
        'border-input': 'var(--border-input)',
        border: 'var(--border-default)',
        'accent-solid-fg': 'var(--accent-solid-fg)',
        'danger-solid-fg': 'var(--danger-solid-fg)',
        accent: {
          DEFAULT: 'var(--accent-primary)',
          hover: 'var(--accent-primary-hover)',
        },
        trust: {
          grounded: 'var(--source-grounded)',
          inference: 'var(--ai-inference)',
          general: 'var(--general-knowledge)',
          warning: 'var(--warning)',
          danger: 'var(--danger)',
          success: 'var(--success)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['var(--font-serif)', '"Source Serif 4"', 'Georgia', 'Cambria', 'serif'],
        mono: ['var(--font-mono)', '"JetBrains Mono"', 'Menlo', 'Monaco', 'monospace'],
      },
      maxWidth: {
        editor: '720px',
      },
      width: {
        sidebar: '220px',
        'sidebar-collapsed': '56px',
        'source-panel': '320px',
        'source-panel-collapsed': '32px',
      },
      height: {
        topbar: '48px',
      },
      transitionDuration: {
        80: '80ms',
        150: '150ms',
        250: '250ms',
        350: '350ms',
        400: '400ms',
        500: '500ms',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16,1,0.3,1)',
        emphasized: 'cubic-bezier(0.05,0.7,0.1,1)',
        'smooth-out': 'cubic-bezier(0.22,1,0.36,1)',
        'ease-out': 'cubic-bezier(0.23,1,0.32,1)',
        'bounce-strong': 'cubic-bezier(0.34,1.56,0.64,1)',
      },
      keyframes: {
        'fade-slide-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        'shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-slide-in': 'fade-slide-in 250ms var(--ease-smooth-out) both',
        'pulse-subtle': 'pulse-subtle 1.4s linear infinite',
        'shimmer': 'shimmer 1.4s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
