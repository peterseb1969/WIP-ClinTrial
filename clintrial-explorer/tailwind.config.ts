import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2B579A',
          light: '#5B9BD5',
        },
        accent: '#ED7D31',
        success: '#2E8B57',
        danger: '#DC3545',
        surface: '#FFFFFF',
        background: '#F8FAFC',
        text: {
          DEFAULT: '#333333',
          muted: '#999999',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        content: '72rem',
      },
    },
  },
  plugins: [],
} satisfies Config
