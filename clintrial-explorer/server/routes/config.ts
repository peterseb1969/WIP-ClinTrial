/**
 * Runtime configuration endpoints. Lets an operator set/rotate the Anthropic
 * API key (used by the AE-cleanup AI features) in a running system without a
 * redeploy. The key is a SECRET: it is never stored in a WIP document and is
 * never echoed back to the caller — responses carry only configured/source/last4.
 *
 * Mounted under requireAdmin() in index.ts.
 */
import { Router } from 'express'
import { getKeyStatus, setAnthropicKey, validateKey } from '../lib/anthropic.js'

const router = Router()

// Masked status — is a key configured, where from, last-4.
router.get('/config/anthropic-key', (_req, res) => {
  res.json(getKeyStatus())
})

// Set/rotate the key. Validates against the API before accepting; persists to
// ANTHROPIC_API_KEY_FILE (0600) by default so it survives a restart.
router.post('/config/anthropic-key', async (req, res) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : ''
  const persist = req.body?.persist !== false // default true
  if (!key) {
    res.status(400).json({ error: 'key is required' })
    return
  }
  const v = await validateKey(key)
  if (!v.ok) {
    res.status(400).json({ error: `Key rejected: ${v.error}` })
    return
  }
  try {
    res.json(setAnthropicKey(key, { persist }))
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to set key' })
  }
})

export default router
