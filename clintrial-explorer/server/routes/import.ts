import { Router } from 'express'
import { initSSE, sendSSE, endSSE } from '../lib/sse.js'
import { runImport, getActiveJob, cancelActiveJob, type ImportOptions } from '../lib/import-orchestrator.js'
import { loadSyncState } from '../lib/sync-state.js'

const router = Router()

const DEFAULT_SPONSORS = ['Hoffmann-La Roche', 'Genentech, Inc.']

/**
 * POST /server-api/import/start
 * Start an import job. Streams progress via SSE while connected.
 * The import continues server-side even if the client disconnects.
 * Body: { mode, sponsors?, nctIds?, sinceDate?, limit?, skipPdfs? }
 */
router.post('/import/start', (req, res) => {
  const activeJob = getActiveJob()
  if (activeJob?.status === 'running') {
    return res.status(409).json({
      error: 'An import is already running',
      job: activeJob,
    })
  }

  const body = req.body || {}
  const options: ImportOptions = {
    mode: body.mode || 'incremental',
    sponsors: body.sponsors?.length ? body.sponsors : DEFAULT_SPONSORS,
    nctIds: body.nctIds,
    sinceDate: body.sinceDate,
    limit: body.limit,
    skipPdfs: body.skipPdfs ?? false,
  }

  initSSE(res)
  sendSSE(res, 'status', { message: 'Import started', options })

  let clientConnected = true
  req.on('close', () => { clientConnected = false })

  // Fire-and-forget: import runs independently of the SSE connection
  runImport(options, (progress) => {
    if (clientConnected) sendSSE(res, 'progress', progress)
  })
    .then((counts) => {
      if (clientConnected) {
        sendSSE(res, 'complete', { counts })
        endSSE(res)
      }
    })
    .catch((err) => {
      if (clientConnected) {
        sendSSE(res, 'error', { message: (err as Error).message })
        endSSE(res)
      }
    })
})

/**
 * GET /server-api/import/status
 * Get status of the current/last import job (used for polling fallback)
 */
router.get('/import/status', (_req, res) => {
  const job = getActiveJob()
  res.json({ job })
})

/**
 * POST /server-api/import/cancel
 * Cancel the running import
 */
router.post('/import/cancel', (_req, res) => {
  const cancelled = cancelActiveJob()
  if (cancelled) {
    res.json({ success: true, message: 'Import cancelled' })
  } else {
    res.status(404).json({ error: 'No running import to cancel' })
  }
})

/**
 * GET /server-api/import/sync-state
 * Get the current sync state
 */
router.get('/import/sync-state', async (_req, res) => {
  try {
    const state = await loadSyncState()
    res.json({
      trial_count: Object.keys(state.trials).length,
      last_sync: state.last_sync,
      last_import_summary: state.last_import_summary,
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
