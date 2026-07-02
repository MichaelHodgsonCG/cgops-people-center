import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        charcoal: '#1F1D1B',
        cream: '#F5F2EE',
        ember: '#C96F4A',
      },
    },
  },
  plugins: [],
} satisfies Config
