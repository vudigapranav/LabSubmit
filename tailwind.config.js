/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // LabSubmit identity, unchanged. Olive is CBIT's green and remains the primary
        // action colour; blue stays the secondary/informational accent.
        brand: {
          olive: {
            50: '#f7fee7',
            100: '#ecfccb',
            200: '#d9f99d',
            300: '#bef264',
            400: '#a3e635',
            500: '#84cc16',
            600: '#65a30d',
            700: '#4d7c0f',
            800: '#3f6212',
            900: '#1a2e05',
            darkSurface: '#121d0a',
          },
          blue: {
            50: '#eff6ff',
            100: '#dbeafe',
            200: '#bfdbfe',
            300: '#93c5fd',
            400: '#60a5fa',
            500: '#3b82f6',
            600: '#2563eb',
            700: '#1d4ed8',
            800: '#1e40af',
            900: '#1e3a8a',
          },
        },
        surface: {
          lightBg: '#f8fafc',
          lightCard: '#ffffff',
          lightBorder: '#e2e8f0',
          darkBg: '#0b0f19',
          darkCard: '#131b2e',
          darkBorder: '#1e293b',
        },
      },
      // A restrained radius scale. Cards and controls share it so the interface reads as
      // one system rather than a collection of differently-rounded boxes.
      borderRadius: {
        card: '1rem',
        control: '0.625rem',
      },
      // Shadows deliberately near-invisible: the reference direction is subtle elevation,
      // with borders doing most of the separation work.
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.03)',
        cardHover: '0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.04)',
        overlay: '0 24px 48px -12px rgb(15 23 42 / 0.25)',
      },
      // One spacing addition for the fixed sidebar width, so the shell and its offsets can
      // never drift apart.
      spacing: {
        sidebar: '16rem',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-up': 'slide-up 0.2s ease-out',
        'slide-in-left': 'slide-in-left 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
