import { Router } from 'express'
import { initSSE, sendSSE, endSSE } from '../lib/sse.js'
import { runImport, getActiveJob, cancelActiveJob, type ImportOptions } from '../lib/import-orchestrator.js'
import { loadSyncState } from '../lib/sync-state.js'
import { wipClient, reportQuery, resolveTemplateId, createDocumentsBulk, SKIP_ERROR_CODES } from '../lib/wip-api.js'

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
      const resp = await wipClient.files.listFiles({
        namespace: 'clintrial', page, page_size: pageSize,
      })

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

    // ONE bulk PATCH for all trials, per-item results checked (CASE-731)
    let linked = 0
    const errors: string[] = []
    const patchItems: Array<{ document_id: string; patch: { documents: string[] } }> = []
    const patchNctIds: string[] = []
    for (const [nctId, fileIds] of nctFiles) {
      const docId = nctToDocId.get(nctId)
      if (!docId) { errors.push(`No document for ${nctId}`); continue }
      patchItems.push({ document_id: docId, patch: { documents: fileIds } })
      patchNctIds.push(nctId)
    }
    if (patchItems.length) {
      try {
        const resp = await wipClient.documents.updateDocuments(patchItems)
        const results = resp.results || []
        for (let i = 0; i < patchItems.length; i++) {
          const item = results[i]
          if (item?.status === 'error') {
            errors.push(`${patchNctIds[i]}: ${item.error || item.message || 'unknown error'}`)
          } else {
            linked++
          }
        }
      } catch (err) {
        errors.push(`bulk patch (${patchItems.length} trials): ${(err as Error).message}`)
      }
    }

    res.json({ success: true, total_files: [...nctFiles.values()].reduce((s, a) => s + a.length, 0), trials_updated: linked, errors: errors.length, error_log: errors })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

const INT_FIELDS = new Set([
  'total_count', 'available', 'marked_for_disposal',
  'in_circulation', 'disposed', 'allocated', 'on_hold',
  'unique_participants', 'distinct_timepoints',
  'use_pk', 'use_biomarker', 'use_protein', 'use_genomics', 'use_pd', 'use_ada', 'use_other',
])
const DATE_FIELDS = new Set(['earliest_collection', 'latest_collection', 'snapshot_date'])

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else current += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { fields.push(current.trim()); current = '' }
      else current += ch
    }
  }
  fields.push(current.trim())
  return fields
}

function parseCsvRows(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase())
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  })
}

const TA_HEADER_MAP: Record<string, string> = {
  'study number': 'study_number',
  'study name': 'study_name',
  'study short title': 'study_short_title',
  'accountable party': 'accountable_party',
  'executing party': 'executing_party',
  'study phase': 'study_phase',
  'study management model (source: veeva-ctms)': 'mgmt_model',
  'study status': 'study_status',
  'study stage': 'study_stage',
  'study type': 'study_type',
  'therapeutic area': 'therapeutic_area',
  'disease area': 'disease_area',
  'indication': 'indication',
  'theme molecule': 'theme_molecule',
  'non-lead molecule': 'non_lead_molecule',
  'sponsor type': 'sponsor_type',
  'theme': 'theme',
  'study actual enrolled': 'actual_enrolled',
  'study actual screened': 'actual_screened',
  'study roche protocol approval': 'dt_protocol_approval',
  'study first site activation': 'dt_first_site_activation',
  'study first subject in screening': 'dt_first_screening',
  'study first subject enrolled': 'dt_first_enrolled',
  'study last subject enrolled': 'dt_last_enrolled',
  'study last subject last visit': 'dt_last_visit',
  'study complete database lock': 'dt_complete_db_lock',
  'study clinical closure': 'dt_clinical_closure',
}

function parseTaPortalCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n')
  // Find the header row — first row containing "Study Number"
  let headerIdx = -1
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    if (lines[i].toLowerCase().includes('study number')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0) return []

  const rawHeaders = parseCsvLine(lines[headerIdx])
  const fieldNames = rawHeaders.map((h) => TA_HEADER_MAP[h.toLowerCase()] || h.toLowerCase().replace(/[^a-z0-9]+/g, '_'))

  const rows: Record<string, string>[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const vals = parseCsvLine(line)
    if (!vals[0]) continue
    const row: Record<string, string> = {}
    fieldNames.forEach((f, j) => { row[f] = vals[j] ?? '' })
    rows.push(row)
  }
  return rows
}

router.post('/import/ta-studies', async (req, res) => {
  try {
    const csvText = req.body?.csv as string
    if (!csvText) {
      return res.status(400).json({ error: 'csv field is required in request body (raw CSV text)' })
    }

    const rows = parseTaPortalCsv(csvText)
    if (!rows.length) {
      return res.status(400).json({ error: 'No data rows found. Expected a CSV with a "Study Number" header row.' })
    }

    const templateId = await resolveTemplateId('CT_TA_STUDY')
    const docs = rows.map((row) => {
      const data: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        if (!v || v === '-' || v === 'N/A') continue
        data[k] = v
      }
      if (!data.study_name && data.study_number) data.study_name = data.study_number
      return data
    })

    const result = await createDocumentsBulk(templateId, docs)

    const errorSample = result.results
      .filter((r) => r.status === 'error' && !SKIP_ERROR_CODES.has(r.error_code || ''))
      .slice(0, 10)
      .map((r) => ({ index: r.index, error: r.error, error_code: r.error_code }))

    res.json({
      success: true,
      total: rows.length,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      error_sample: errorSample,
    })
  } catch (err) {
    console.error('[import/ta-studies]', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/import/sami-summary', async (req, res) => {
  try {
    const csvText = req.body?.csv as string
    if (!csvText) {
      return res.status(400).json({ error: 'csv field is required in request body (raw CSV text)' })
    }

    const rows = parseCsvRows(csvText)
    if (!rows.length) {
      return res.status(400).json({ error: 'No data rows found in CSV' })
    }

    const templateId = await resolveTemplateId('CT_SAMI_STUDY_SUMMARY')
    const docs = rows.map((row) => {
      const data: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        if (!v) continue
        if (INT_FIELDS.has(k)) data[k] = parseInt(v, 10)
        else if (DATE_FIELDS.has(k)) data[k] = v.slice(0, 10)
        else data[k] = v
      }
      if (!data.source_system) data.source_system = 'SAMI'
      if (!data.snapshot_date) data.snapshot_date = new Date().toISOString().slice(0, 10)
      return data
    })

    const result = await createDocumentsBulk(templateId, docs)

    const errorSample = result.results
      .filter((r) => r.status === 'error' && !SKIP_ERROR_CODES.has(r.error_code || ''))
      .slice(0, 10)
      .map((r) => ({ index: r.index, error: r.error, error_code: r.error_code }))

    res.json({
      success: true,
      total: rows.length,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      error_sample: errorSample,
    })
  } catch (err) {
    console.error('[import/sami-summary]', err)
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
