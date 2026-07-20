import { createWipClient } from '@wip/client'
import { getConfig } from './config'

// baseUrl is the full origin + base path (e.g. "https://wip-kubi.local/apps/clintrial")
// API key is injected server-side by @wip/proxy — auth is omitted entirely:
// client 0.30.0 has no `type: 'none'`; leaving `auth` unset sends no auth
// header, which is the correct behind-proxy configuration (CASE-726)
export const wipClient = createWipClient({
  baseUrl: getConfig().wipApiUrl,
})
