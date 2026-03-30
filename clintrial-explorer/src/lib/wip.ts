import { createWipClient } from '@wip/client'
import { getConfig } from './config'

// baseUrl is the full origin + base path (e.g. "https://wip-kubi.local/apps/clintrial")
// API key is injected server-side by @wip/proxy — not needed in the browser
export const wipClient = createWipClient({
  baseUrl: getConfig().wipApiUrl,
  auth: { type: 'api-key', key: '' },
})
