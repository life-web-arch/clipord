import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './extension/**/*.{ts,tsx,html}',
    './shared/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        clipord: {
          50:  '#f0f4ff',
          100: '#e0e9ff',
          200: '#c7d6fe',
          300: '#a5b8fc',
          400: '#8193f8',
          500: '#6470f1',
          600: '#4f52e5',
          700: '#4141ca',
          800: '#3636a4',
          900: '#313182',
          950: '#1e1c4b',
        },
        surface: {
          0:   '#ffffff',
          50:  '#f8f9fc',
          100: '#f0f2f8',
          200: '#e4e7f0',
          300: '#d1d5e4',
        },
        dark: {
          0:   '#0f0f14',
          50:  '#16161e',
          100: '#1c1c28',
          200: '#242434',
          300: '#2e2e42',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'slide-up':    'slideUp 0.2s ease-out',
        'slide-down':  'slideDown 0.2s ease-out',
        'fade-in':     'fadeIn 0.15s ease-out',
        'toast-in':    'toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        'toast-out':   'toastOut 0.2s ease-in forwards',
      },
      keyframes: {
        slideUp:   { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        slideDown: { from: { transform: 'translateY(-8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        fadeIn:    { from: { opacity: '0' }, to: { opacity: '1' } },
        toastIn:   { from: { transform: 'translateX(100%)', opacity: '0' }, to: { transform: 'translateX(0)', opacity: '1' } },
        toastOut:  { from: { transform: 'translateX(0)', opacity: '1' }, to: { transform: 'translateX(100%)', opacity: '0' } },
      },
    },
  },
  plugins: [],
  darkMode: 'class',
} satisfies Config
