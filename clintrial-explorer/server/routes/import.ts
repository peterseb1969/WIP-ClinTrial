import { Router } from 'express'
import { initSSE, sendSSE, endSSE } from '../lib/sse.js'
import { runImport, getActiveJob, cancelActiveJob, type ImportOptions } from '../lib/import-orchestrator.js'
import { loadSyncState } from '../lib/sync-state.js'
import { wipGet, wipPatch, reportQuery } from '../lib/wip-api.js'

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

/**
 * POST /server-api/import/link-orphan-files
 * One-off: scan uploaded files, extract NCT IDs from tags, PATCH trials to link them
 */
router.post('/import/link-orphan-files', async (_req, res) => {
  try {
    // Fetch all files, paginated
    const nctFiles = new Map<string, string[]>()
    let page = 1
    const pageSize = 100

    while (true) {
      const resp = await wipGet(
        `/api/document-store/files?namespace=clintrial&page=${page}&page_size=${pageSize}`,
      ) as { items?: Array<{ file_id: string; metadata?: { tags?: string[] } }>; total?: number }

      const files = resp.items || []
      if (!files.length) break

      for (const file of files) {
        const tags = file.metadata?.tags || []
        const nctId = tags.find((t: string) => t.startsWith('NCT'))
        if (nctId && file.file_id) {
          if (!nctFiles.has(nctId)) nctFiles.set(nctId, [])
          nctFiles.get(nctId)!.push(file.file_id)
        }
      }

      if (files.length < pageSize) break
      page++
    }

    if (!nctFiles.size) {
      return res.json({ success: true, total_files: 0, trials_updated: 0, errors: 0 })
    }

    // Look up document_ids
    const nctIds = [...nctFiles.keys()]
    const placeholders = nctIds.map((_, i) => `$${i + 1}`).join(',')
    const docRows = await reportQuery<{ document_id: string; nct_id: string }>(
      `SELECT document_id, nct_id FROM doc_ct_trial WHERE nct_id IN (${placeholders})`,
      nctIds,
      10000,
    )

    const nctToDocId = new Map<string, string>()
    for (const row of docRows.rows) nctToDocId.set(row.nct_id, row.document_id)

    // PATCH each trial with file IDs
    let linked = 0
    const errors: string[] = []
    for (const [nctId, fileIds] of nctFiles) {
      const docId = nctToDocId.get(nctId)
      if (!docId) { errors.push(`No document for ${nctId}`); continue }
      try {
        await wipPatch('/api/document-store/documents', [{
          document_id: docId,
          patch: { documents: fileIds },
        }])
        linked++
      } catch (err) {
        errors.push(`${nctId}: ${(err as Error).message}`)
      }
    }

    res.json({ success: true, total_files: [...nctFiles.values()].reduce((s, a) => s + a.length, 0), trials_updated: linked, errors: errors.length, error_log: errors })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
