import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    base: env.VITE_BASE_PATH || '/apps/clintrial',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: parseInt(env.VITE_APP_PORT || '3001'),
      allowedHosts: true,
      proxy: {
        '/api': {
          target: env.VITE_WIP_HOST || 'https://localhost:8443',
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            const apiKey = env.VITE_WIP_API_KEY || ''
            if (apiKey) {
              proxy.on('proxyReq', (proxyReq) => {
                proxyReq.setHeader('X-API-Key', apiKey)
              })
            }
          },
        },
      },
    },
  }
})
