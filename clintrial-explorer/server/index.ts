// MUST be first: loads .env into process.env before any other module reads it
import './load-env.js'

import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { wipProxy } from '@wip/proxy'
import classifyRoutes from './routes/classify.js'
import importRoutes from './routes/import.js'
import aeCleanupRoutes from './routes/ae-cleanup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = parseInt(process.env.PORT || '3013')
const WIP_BASE_URL = process.env.WIP_BASE_URL || 'https://localhost:8443'
const WIP_API_KEY = process.env.WIP_API_KEY || 'dev_master_key_for_testing'

// Parse JSON for custom server-api routes (BEFORE wipProxy which uses express.raw())
app.use('/server-api', express.json({ limit: '50mb' }))

// Mount custom server routes
app.use('/server-api', classifyRoutes)
app.use('/server-api', importRoutes)
app.use('/server-api', aeCleanupRoutes)

// Proxy /api/* and /files/* to WIP backend (injects API key server-side)
app.use(wipProxy({ baseUrl: WIP_BASE_URL, apiKey: WIP_API_KEY }))

// Health endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'clintrial-explorer' })
})

// Serve static files from Vite build
app.use(express.static(path.join(__dirname, '../dist')))

// SPA fallback — serve index.html for all unmatched routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'))
})

app.listen(PORT, () => {
  console.log(`ClinTrial Explorer server running on port ${PORT}`)
})
