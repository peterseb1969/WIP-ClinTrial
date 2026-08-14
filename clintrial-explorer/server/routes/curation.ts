import { Router } from 'express'
import {
  wipPost,
  wipPatch,
  wipGet,
  reportQuery,
  resolveTemplateId,
  createDocumentsBulk,
  NAMESPACE,
} from '../lib/wip-api.js'

const router = Router()

interface MatchData {
  study_number: string
  nct_id: string
  confidence: string
  signals: Record<string, unknown>
  signal_count: number
  roche_title: string
  ctgov_title: string
}

// POST /curation/load-candidates — create CT_CURATION_TASK docs from uploaded match data
router.post('/curation/load-candidates', async (req, res) => {
  try {
    const matches: MatchData[] = req.body.matches
    if (!Array.isArray(matches) || matches.length === 0) {
      return res.status(400).json({ error: 'matches array is required in request body' })
    }

    const confidenceFilter = req.body.min_confidence || 'high'
    const allowed = confidenceFilter === 'medium'
      ? ['high', 'medium']
      : confidenceFilter === 'low'
        ? ['high', 'medium', 'low']
        : ['high']

    const filtered = matches.filter((m) => allowed.includes(m.confidence))

    // Exclude studies already reviewed (non-PENDING) to preserve curation work
    const existingResult = await reportQuery<{ item_key: string; data_status: string }>(
      `SELECT item_key, data_status FROM doc_ct_curation_task
       WHERE topic = 'study_crosswalk' AND data_status != 'PENDING' AND status = 'active'`,
      [],
      20000,
    )
    const reviewed = new Set(existingResult.rows.map((r) => r.item_key))
    const newCandidates = filtered.filter((m) => !reviewed.has(m.study_number))

    const templateId = await resolveTemplateId('CT_CURATION_TASK')

    const docs = newCandidates.map((m) => ({
      topic: 'study_crosswalk',
      item_key: m.study_number,
      status: 'PENDING',
      confidence: m.confidence,
      match_data: JSON.stringify({
        nct_id: m.nct_id,
        signals: m.signals,
        signal_count: m.signal_count,
        roche_title: m.roche_title,
        ctgov_title: m.ctgov_title,
      }),
    }))

    const result = await createDocumentsBulk(templateId, docs)

    res.json({
      total: filtered.length,
      created: result.created,
      existing: result.updated,
      errors: result.errors,
      skipped_reviewed: filtered.length - newCandidates.length,
    })
  } catch (err) {
    console.error('[curation/load-candidates]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// POST /curation/review — approve/reject/skip a curation task
router.post('/curation/review', async (req, res) => {
  try {
    const { document_id, decision, notes } = req.body
    if (!document_id || !decision) {
      return res.status(400).json({ error: 'document_id and decision are required' })
    }
    if (!['approved', 'rejected', 'skipped'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be approved, rejected, or skipped' })
    }

    const statusMap: Record<string, string> = {
      approved: 'APPROVED',
      rejected: 'REJECTED',
      skipped: 'SKIPPED',
    }

    const patch: Record<string, unknown> = {
      status: statusMap[decision],
      reviewed_by: 'curator',
      reviewed_at: new Date().toISOString(),
    }
    if (notes) patch.notes = notes

    const patchResult = await wipPatch(
      `/api/document-store/documents/${document_id}`,
      { patch },
    )

    if (decision === 'approved') {
      const doc = (await wipGet(
        `/api/document-store/documents/${document_id}`,
      )) as { data: { topic: string; match_data: string; item_key: string } }

      if (doc.data.topic === 'study_crosswalk') {
        const matchData = JSON.parse(doc.data.match_data)
        await applyStudyCrosswalk(doc.data.item_key, matchData.nct_id, matchData)
      }
    }

    res.json({ ok: true, result: patchResult })
  } catch (err) {
    console.error('[curation/review]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// POST /curation/bulk-review — approve/reject multiple at once
router.post('/curation/bulk-review', async (req, res) => {
  try {
    const { document_ids, decision } = req.body as {
      document_ids: string[]
      decision: string
    }
    if (!document_ids?.length || !decision) {
      return res.status(400).json({ error: 'document_ids and decision are required' })
    }

    const statusMap: Record<string, string> = {
      approved: 'APPROVED',
      rejected: 'REJECTED',
      skipped: 'SKIPPED',
    }
    const now = new Date().toISOString()
    let succeeded = 0
    let failed = 0

    for (const docId of document_ids) {
      try {
        await wipPatch(`/api/document-store/documents/${docId}`, {
          patch: {
            status: statusMap[decision],
            reviewed_by: 'curator',
            reviewed_at: now,
          },
        })

        if (decision === 'approved') {
          const doc = (await wipGet(
            `/api/document-store/documents/${docId}`,
          )) as { data: { topic: string; match_data: string; item_key: string } }

          if (doc.data.topic === 'study_crosswalk') {
            const matchData = JSON.parse(doc.data.match_data)
            await applyStudyCrosswalk(doc.data.item_key, matchData.nct_id, matchData)
          }
        }
        succeeded++
      } catch (err) {
        failed++
        console.error(`[curation/bulk-review] Failed for ${docId}:`, err)
      }
    }

    res.json({ succeeded, failed, total: document_ids.length })
  } catch (err) {
    console.error('[curation/bulk-review]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// POST /curation/clear — delete all curation tasks for a topic
router.post('/curation/clear', async (req, res) => {
  try {
    const { topic } = req.body
    if (!topic) {
      return res.status(400).json({ error: 'topic is required' })
    }

    const result = await reportQuery<{ document_id: string }>(
      `SELECT document_id FROM doc_ct_curation_task WHERE topic = $1`,
      [topic],
      10000,
    )

    if (result.rows.length === 0) {
      return res.json({ deleted: 0 })
    }

    const ids = result.rows.map((r) => r.document_id)
    const batchSize = 100
    let deleted = 0

    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      await wipPost('/api/document-store/documents/archive', batch.map((id) => ({ id })))
      deleted += batch.length
    }

    res.json({ deleted })
  } catch (err) {
    console.error('[curation/clear]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// GET /curation/stats — counts per topic per status
router.get('/curation/stats', async (_req, res) => {
  try {
    const result = await reportQuery<{
      topic: string
      status: string
      cnt: number
    }>(
      `SELECT topic, data_status as status, COUNT(*) as cnt
       FROM doc_ct_curation_task
       WHERE status = 'active'
       GROUP BY topic, data_status
       ORDER BY topic, data_status`,
    )
    res.json({ stats: result.rows })
  } catch (err) {
    console.error('[curation/stats]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

async function applyStudyCrosswalk(
  studyNumber: string,
  nctId: string,
  matchData: Record<string, unknown>,
): Promise<void> {
  const studyResult = await reportQuery<{ document_id: string }>(
    `SELECT document_id FROM doc_ct_ta_study
     WHERE study_number = $1 LIMIT 1`,
    [studyNumber],
  )
  const trialResult = await reportQuery<{ document_id: string }>(
    `SELECT document_id FROM doc_ct_trial
     WHERE nct_id = $1 LIMIT 1`,
    [nctId],
  )

  if (!studyResult.rows.length || !trialResult.rows.length) {
    console.warn(
      `[crosswalk] Missing doc: study=${studyNumber} (${studyResult.rows.length}), nct=${nctId} (${trialResult.rows.length})`,
    )
    return
  }

  const studyDocId = studyResult.rows[0].document_id
  const trialDocId = trialResult.rows[0].document_id

  // Link nct_id on the TA study. Documents pinned to template v1/v2 don't have
  // the nct_id field, so a PATCH would fail with validation_failed. Instead,
  // fetch the full document and re-post (upsert) against the latest template
  // version — this migrates the doc to v3 and adds the field in one step.
  const studyDoc = (await wipGet(
    `/api/document-store/documents/${studyDocId}`,
  )) as { data: Record<string, unknown> }
  const templateId = await resolveTemplateId('CT_TA_STUDY')
  await wipPost('/api/document-store/documents', [
    {
      template_id: templateId,
      namespace: NAMESPACE,
      data: { ...studyDoc.data, nct_id: nctId },
    },
  ])

  // Create crosswalk edge
  const crosswalkTemplateId = await resolveTemplateId('CT_STUDY_CROSSWALK')
  await wipPost('/api/document-store/documents', [
    {
      template_id: crosswalkTemplateId,
      namespace: NAMESPACE,
      data: {
        source_ref: studyDocId,
        target_ref: trialDocId,
        confidence: String(matchData.confidence || 'fuzzy'),
        source: 'fuzzy_matcher',
        match_method: 'tfidf_multi_signal',
        title_similarity: String(
          (matchData.signals as Record<string, unknown>)?.title_sim ?? '',
        ),
      },
    },
  ])
}

export default router
