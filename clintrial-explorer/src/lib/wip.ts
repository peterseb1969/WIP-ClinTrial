import { createWipClient } from '@wip/client'
import { config } from './config'

export const wipClient = createWipClient({
  baseUrl: config.wipHost || '',
  auth: { type: 'api-key', key: config.wipApiKey },
})
