import { Router } from 'express'
import { checkStatus, runBootstrap, type BootstrapProgress } from '../lib/bootstrap.js'
import { initSSE, sendSSE, endSSE } from '../lib/sse.js'

const router = Router()

/**
 * GET /server-api/bootstrap/status
 * Check if WIP is reachable and namespace is bootstrapped
 */
router.get('/bootstrap/status', async (_req, res) => {
  try {
    const status = await checkStatus()
    res.json({ status })
  } catch (err) {
    res.json({ status: 'wip_unreachable', error: (err as Error).message })
  }
})

/**
 * POST /server-api/bootstrap/run
 * Execute the bootstrap process. Streams progress via SSE.
 */
router.post('/bootstrap/run', (req, res) => {
  initSSE(res)

  let clientConnected = true
  req.on('close', () => { clientConnected = false })

  runBootstrap((p: BootstrapProgress) => {
    if (clientConnected) sendSSE(res, p.done ? 'complete' : 'progress', p)
  })
    .then(() => {
      if (clientConnected) endSSE(res)
    })
    .catch((err) => {
      if (clientConnected) {
        sendSSE(res, 'error', { message: (err as Error).message })
        endSSE(res)
      }
    })
})

export default router
