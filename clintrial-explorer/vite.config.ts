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
        '/server-api': {
          target: `http://localhost:${env.PORT || '3013'}`,
          changeOrigin: true,
        },
        '/api': {
          target: `http://localhost:${env.PORT || '3013'}`,
          changeOrigin: true,
        },
        [`${env.VITE_BASE_PATH || '/apps/clintrial'}/api`]: {
          target: `http://localhost:${env.PORT || '3013'}`,
          changeOrigin: true,
          rewrite: (p: string) => p.replace(env.VITE_BASE_PATH || '/apps/clintrial', ''),
        },
        '/files': {
          target: `http://localhost:${env.PORT || '3013'}`,
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
