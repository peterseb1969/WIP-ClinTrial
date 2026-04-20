import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const BASE = (env.VITE_BASE_PATH || env.APP_BASE_PATH || '').replace(/\/$/, '')
  const target = `http://localhost:${env.PORT || '3001'}`
  const apiKey = env.VITE_WIP_API_KEY || ''
  const attachApiKey = (proxy: { on: (ev: string, cb: (r: { setHeader: (k: string, v: string) => void }) => void) => void }) => {
    if (apiKey) proxy.on('proxyReq', (r) => r.setHeader('X-API-Key', apiKey))
  }

  return {
    plugins: [react()],
    base: BASE || '/',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: parseInt(env.VITE_APP_PORT || '5174'),
      allowedHosts: true,
      proxy: {
        [`${BASE}/api`]: { target, changeOrigin: true },
        [`${BASE}/server-api`]: { target, changeOrigin: true },
        [`${BASE}/files`]: { target, changeOrigin: true, secure: false, configure: attachApiKey },
        [`${BASE}/health`]: { target, changeOrigin: true },
      },
    },
  }
})
