import { createWipClient } from '@wip/client'
import { config } from './config'

// In browser: use empty baseUrl so requests go to same origin (proxied by Vite/Caddy)
// The VITE_WIP_HOST env var is only used for the proxy target, not by the client directly
export const wipClient = createWipClient({
  baseUrl: '',
  auth: { type: 'api-key', key: config.wipApiKey },
})
