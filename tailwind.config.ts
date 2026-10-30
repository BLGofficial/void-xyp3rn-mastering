import type { Config } from 'tailwindcss';

// XYP3RN Tech palette (Color Palette 2026). One accent, one surface hierarchy,
// three text levels. Amber is Records-only and deliberately absent.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      studio: '#080808', // primary canvas
      panel: '#0D0D0D', // cards, sections
      surface: '#111111', // raised UI, hover
      chrome: '#000000', // bars, nav
      gold: { DEFAULT: '#FACD68', dim: '#C9A03E', glow: '#2A1E00' },
      cloud: '#E8E8E8', // headings, key content
      ash: '#888888', // body copy
      muted: '#444444', // metadata
      white: '#FFFFFF', // high-contrast emphasis only
      line: { DEFAULT: '#1A1A1A', card: '#222222' }, // borders
      code: { bg: '#0A0A0A', fg: '#D4D4D4' },
    },
    fontFamily: {
      display: ['var(--font-bebas)', 'Impact', 'sans-serif'],
      heading: ['var(--font-syne)', 'system-ui', 'sans-serif'],
      body: ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
      mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
    },
    extend: {
      letterSpacing: { label: '0.12em' },
    },
  },
  plugins: [],
};

export default config;
