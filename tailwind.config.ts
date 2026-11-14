import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#0a0c12', 900: '#10131c', 800: '#171b27', 700: '#222838', 600: '#323a4f' },
        volt: { 300: '#ffe566', 400: '#ffd60a', 500: '#f5b700' },
        ember: { 400: '#ff6b57', 500: '#ef4733' },
        mint: { 400: '#3ddc97' },
      },
      fontFamily: {
        display: ['"Segoe UI Variable Display"', '"SF Pro Display"', 'system-ui', 'sans-serif'],
      },
      aspectRatio: { card: '63 / 88' },
    },
  },
  plugins: [],
};

export default config;
