import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/apps/clintrial',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: parseInt(process.env.VITE_APP_PORT || '3001'),
    proxy: {
      '/api': {
        target: process.env.VITE_WIP_HOST || 'https://localhost:8443',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
