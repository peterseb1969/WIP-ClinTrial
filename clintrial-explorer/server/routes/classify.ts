import { Router } from 'express'
import { initSSE, sendSSE, endSSE } from '../lib/sse.js'
import {
  reportQuery,
  resolveTemplateId,
  createDocumentsBulk,
  NAMESPACE,
} from '../lib/wip-api.js'
import {
  classifyTrials,
  type ClassificationRule,
  type TrialForClassification,
} from '../lib/classifier.js'
import { classifyTherapeuticAreas, loadTAKeywordMap } from '../lib/transforms.js'
import { loadTAAncestors } from '../lib/ta-ontology.js'

const router = Router()

/** Fetch classification rules from WIP */
async function fetchRules(): Promise<ClassificationRule[]> {
  try {
    const templateId = await resolveTemplateId('CT_CLASSIFICATION_RULE')
    const res = (await import('../lib/wip-api.js').then((m) =>
      m.wipPost('/api/document-store/documents/query', {
        template_id: templateId,
        status: 'active',
        page_size: 100,
      }),
    )) as { items?: Record<string, unknown>[]; results?: Record<string, unknown>[] }

    const items = res.items ?? res.results ?? []
    return items.map((doc) => {
      const d = (doc.data ?? doc) as Record<string, unknown>
      return {
        document_id: (doc.document_id ?? doc.id ?? '') as string,
        rule_type: (d.rule_type as string) || 'CONDITION_TO_TA',
        pattern: (d.pattern as string) || '',
        match_type: (d.match_type as string) || 'CONTAINS',
        action: (d.action as string) || 'ADD',
        target_ta: (d.target_ta as string) || '',
        priority: (d.priority as number) ?? 0,
        enabled: (d.enabled as boolean) ?? true,
        notes: (d.notes as string) || null,
        trial_nct_id: (d.trial_nct_id as string) || null,
      }
    }).sort((a, b) => b.priority - a.priority || a.pattern.localeCompare(b.pattern))
  } catch {
    // No rules is fine — keyword map alone can classify
    return []
  }
}

function parseJsonArray(val: string | null | undefined): string[] {
  if (!val) return []
  try {
    return JSON.parse(val)
  } catch {
    return []
  }
}

/** Fetch trials from reporting SQL */
async function fetchTrials(
  trialIds?: string[],
): Promise<TrialForClassification[]> {
  let sql = `SELECT t.document_id, t.nct_id, t.title, t.data_status as status,
                    t.study_type, t.sponsor, t.therapeutic_areas, t.ta_pinned,
                    t.conditions, t.brief_title, t.acronym, t.brief_summary,
                    t.enrollment, t.start_date, t.primary_completion_date,
                    t.completion_date, t.phases, t.interventions, t.collaborators,
                    t.eligibility_criteria, t.minimum_age, t.maximum_age,
                    t.sex, t.healthy_volunteers, t.has_results, t.ctgov_url
             FROM doc_ct_trial t
             WHERE t.status = 'active'`
  const params: string[] = []

  if (trialIds && trialIds.length > 0) {
    const placeholders = trialIds.map((_, i) => `$${i + 1}`).join(', ')
    sql += ` AND t.nct_id IN (${placeholders})`
    params.push(...trialIds)
  }

  const result = await reportQuery<Record<string, unknown>>(sql, params)

  return result.rows.map((r) => ({
    document_id: r.document_id as string,
    nct_id: r.nct_id as string,
    title: (r.title as string) || '',
    brief_title: (r.brief_title as string) || undefined,
    acronym: (r.acronym as string) || undefined,
    status: (r.status as string) || 'UNKNOWN',
    study_type: (r.study_type as string) || '',
    sponsor: (r.sponsor as string) || '',
    therapeutic_areas: parseJsonArray(r.therapeutic_areas as string),
    ta_pinned: (r.ta_pinned as boolean) ?? false,
    conditions: parseJsonArray(r.conditions as string),
    phases: parseJsonArray(r.phases as string),
    interventions: parseJsonArray(r.interventions as string),
    collaborators: parseJsonArray(r.collaborators as string),
    brief_summary: (r.brief_summary as string) || undefined,
    enrollment: r.enrollment as number | undefined,
    start_date: (r.start_date as string) || undefined,
    primary_completion_date: (r.primary_completion_date as string) || undefined,
    completion_date: (r.completion_date as string) || undefined,
    eligibility_criteria: (r.eligibility_criteria as string) || undefined,
    minimum_age: (r.minimum_age as string) || undefined,
    maximum_age: (r.maximum_age as string) || undefined,
    sex: (r.sex as string) || undefined,
    healthy_volunteers: (r.healthy_volunteers as string) || undefined,
    has_results: (r.has_results as boolean) ?? false,
    ctgov_url: (r.ctgov_url as string) || undefined,
  }))
}

/**
 * POST /server-api/classify
 * Run classification rules against trials. Streams progress via SSE.
 * Body: { trialIds?: string[], dryRun?: boolean }
 */
router.post('/classify', async (req, res) => {
  const { trialIds, dryRun = false } = req.body || {}

  initSSE(res)
  sendSSE(res, 'status', { phase: 'loading', message: 'Fetching rules and trials...' })

  try {
    const [rules, trials, taKeywords, ancestorMap] = await Promise.all([
      fetchRules(),
      fetchTrials(trialIds),
      loadTAKeywordMap(),
      loadTAAncestors(),
    ])

    const ontologyEdges = [...ancestorMap.values()].reduce((n, s) => n + s.size, 0)
    sendSSE(res, 'status', {
      phase: 'classifying',
      message: `Classifying ${trials.length} trials with ${rules.length} rules + keyword map (${taKeywords.size} TAs), ontology: ${ancestorMap.size} children / ${ontologyEdges} ancestor links`,
      total: trials.length,
    })

    // Save original TAs, then enrich with keyword map before running rules
    const originalTAs = new Map<string, string[]>()
    for (const trial of trials) {
      originalTAs.set(trial.nct_id, [...(trial.therapeutic_areas || [])])
      if (!trial.ta_pinned && taKeywords.size > 0) {
        const keywordTAs = classifyTherapeuticAreas(trial.conditions || [], taKeywords)
        if (keywordTAs.length > 0) {
          const merged = new Set([...(trial.therapeutic_areas || []), ...keywordTAs])
          trial.therapeutic_areas = [...merged].sort()
        }
      }
    }

    // classifyTrials compares current trial.therapeutic_areas (now enriched) as baseline,
    // then applies rules on top. But we want to detect changes vs the ORIGINAL stored TAs.
    // So we run classifyTrials (which applies rules on the enriched baseline),
    // then compare final result against originalTAs.
    const results = classifyTrials(trials, rules, ancestorMap)

    // Fix change detection: compare against original stored TAs, not enriched baseline
    for (const r of results) {
      if (r.pinned) continue
      const orig = (originalTAs.get(r.nct_id) || []).sort()
      const changed =
        r.new_tas.length !== orig.length ||
        r.new_tas.some((ta, i) => ta !== orig[i])
      r.changed = changed
      r.old_tas = orig
    }
    const changedResults = results.filter((r) => r.changed)
    const pinnedCount = results.filter((r) => r.pinned).length

    // Stream individual results
    for (let i = 0; i < results.length; i++) {
      if (results[i].changed || results[i].pinned) {
        sendSSE(res, 'result', results[i])
      }
      if (i % 50 === 0) {
        sendSSE(res, 'progress', { processed: i + 1, total: results.length })
      }
    }

    // Write back if not dry run
    let writeErrors: { nct_id: string; error: string }[] = []
    if (!dryRun && changedResults.length > 0) {
      sendSSE(res, 'status', {
        phase: 'writing',
        message: `Writing ${changedResults.length} updated trials to WIP...`,
      })

      const templateId = await resolveTemplateId('CT_TRIAL')

      // Build upsert data — must include all mandatory fields
      const upsertData = changedResults.map((r) => {
        const trial = trials.find((t) => t.nct_id === r.nct_id)!
        return {
          nct_id: trial.nct_id,
          title: trial.title,
          brief_title: trial.brief_title,
          acronym: trial.acronym,
          status: trial.status,
          phases: trial.phases,
          study_type: trial.study_type,
          therapeutic_areas: r.new_tas,
          ta_pinned: false,
          brief_summary: trial.brief_summary,
          enrollment: trial.enrollment,
          start_date: trial.start_date,
          primary_completion_date: trial.primary_completion_date,
          completion_date: trial.completion_date,
          sponsor: trial.sponsor,
          collaborators: trial.collaborators,
          interventions: trial.interventions,
          conditions: trial.conditions,
          eligibility_criteria: trial.eligibility_criteria,
          minimum_age: trial.minimum_age,
          maximum_age: trial.maximum_age,
          sex: trial.sex,
          healthy_volunteers: trial.healthy_volunteers,
          has_results: trial.has_results,
          ctgov_url: trial.ctgov_url,
        }
      })

      const bulkResult = await createDocumentsBulk(templateId, upsertData)
      // Bulk-first (PoNIF #4): HTTP 200 can carry per-item failures. Attribute
      // each failed upsert to its trial — results[] aligns by index with
      // upsertData/changedResults (CASE-725; re-verify ordering if CASE-731
      // reworks batching).
      writeErrors = bulkResult.results
        .filter((r) => r.status === 'error')
        .map((r) => ({
          nct_id: changedResults[r.index]?.nct_id ?? `index ${r.index}`,
          error: r.error || r.message || 'unknown error',
        }))
      for (const e of writeErrors) {
        console.error(`[classify] trial upsert failed ${e.nct_id}: ${e.error}`)
      }
      sendSSE(res, 'write-result', bulkResult)
    }

    sendSSE(res, 'complete', {
      total: results.length,
      changed: changedResults.length,
      pinned: pinnedCount,
      unchanged: results.length - changedResults.length - pinnedCount,
      dryRun,
      write_failed: writeErrors.length,
      write_errors: writeErrors,
    })
  } catch (err) {
    sendSSE(res, 'error', { message: (err as Error).message })
  }

  endSSE(res)
})

/**
 * POST /server-api/pin
 * Pin/unpin a trial's therapeutic areas.
 * Body: { nct_id: string, pinned: boolean, therapeutic_areas?: string[] }
 */
router.post('/pin', async (req, res) => {
  const { nct_id, pinned, therapeutic_areas } = req.body || {}

  if (!nct_id) {
    return res.status(400).json({ error: 'nct_id is required' })
  }

  try {
    // Fetch current trial data
    const trials = await fetchTrials([nct_id])
    if (trials.length === 0) {
      return res.status(404).json({ error: `Trial ${nct_id} not found` })
    }

    const trial = trials[0]
    const documentId = (trial as { document_id?: string }).document_id
    if (!documentId) {
      return res.status(404).json({ error: `No document_id for ${nct_id}` })
    }

    // Merge-patch ONLY the two fields being changed (CASE-731): identity
    // (nct_id) and every other field stay untouched, so a concurrent edit
    // can't be clobbered by a full re-upsert of stale mandatory fields.
    const { wipPatch } = await import('../lib/wip-api.js')
    const resp = (await wipPatch('/api/document-store/documents', [{
      document_id: documentId,
      patch: {
        therapeutic_areas: therapeutic_areas ?? trial.therapeutic_areas,
        ta_pinned: pinned,
      },
    }])) as { results?: Array<{ status?: string; error?: string; message?: string }> } | Array<{ status?: string; error?: string; message?: string }>
    const item = Array.isArray(resp) ? resp[0] : resp.results?.[0]
    if (item?.status === 'error') {
      return res.status(422).json({ error: item.error || item.message || 'patch failed', nct_id })
    }
    res.json({ success: true, nct_id, pinned, result: item })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
