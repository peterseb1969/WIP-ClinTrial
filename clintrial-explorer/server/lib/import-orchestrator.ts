/**
 * Import orchestrator — coordinates the full import pipeline.
 * Ported from scripts/import_trials.py main() flow.
 */

import { searchTrialsBySponsor, fetchTrialResultsAndDocs, fetchTrialsByNctIds } from './ctgov.js'
import { extractTrialData, getLastUpdateDate } from './transforms.js'
import { loadSyncState, saveSyncState, shouldSkipTrial, updateTrialSyncEntry, type SyncState } from './sync-state.js'
import {
  initPipeline,
  createOrganizationsBulk,
  ensureCountryTerms,
  ensureMoleculeTerms,
  buildTrialDoc,
  buildOutcomeDocs,
  buildSiteDocs,
  buildAEDocs,
  buildBaselineDocs,
  buildOutcomeResultDocs,
  downloadAndUploadPdfs,
  linkFilesBulk,
  DocBatcher,
  newCounts,
  clearCaches,
  type ImportCounts,
} from './import-pipeline.js'

export interface ImportOptions {
  mode: 'incremental' | 'full'
  sponsors: string[]
  nctIds?: string[]
  sinceDate?: string
  limit?: number
  skipPdfs?: boolean
}

export interface ImportProgress {
  phase: string
  step: string
  processed: number
  total: number
  current_nct_id?: string
  counts: ImportCounts
}

export type ProgressCallback = (progress: ImportProgress) => void

/** Active job tracking */
let activeJob: {
  id: string
  status: 'running' | 'cancelled' | 'completed' | 'error'
  startedAt: Date
  abortController: AbortController
  progress: ImportProgress
} | null = null

export function getActiveJob() {
  return activeJob
    ? {
        id: activeJob.id,
        status: activeJob.status,
        startedAt: activeJob.startedAt.toISOString(),
        progress: activeJob.progress,
      }
    : null
}

export function cancelActiveJob(): boolean {
  if (!activeJob || activeJob.status !== 'running') return false
  activeJob.abortController.abort()
  activeJob.status = 'cancelled'
  return true
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Run the full import pipeline */
export async function runImport(
  options: ImportOptions,
  onProgress: ProgressCallback,
): Promise<ImportCounts> {
  if (activeJob?.status === 'running') {
    throw new Error('An import is already running')
  }

  const abortController = new AbortController()
  const signal = abortController.signal
  const counts = newCounts()
  const jobId = `import-${Date.now()}`

  activeJob = {
    id: jobId,
    status: 'running',
    startedAt: new Date(),
    abortController,
    progress: { phase: 'init', step: 'Starting...', processed: 0, total: 0, counts },
  }

  const progress = (phase: string, step: string, processed: number, total: number, nctId?: string) => {
    const p: ImportProgress = { phase, step, processed, total, current_nct_id: nctId, counts }
    if (activeJob) activeJob.progress = p
    onProgress(p)
  }

  try {
    // Phase 0: Initialize
    progress('init', 'Resolving templates and loading keyword maps...', 0, 0)
    clearCaches()
    await initPipeline()

    // Load sync state
    progress('init', 'Loading sync state...', 0, 0)
    const syncState: SyncState = options.mode === 'full'
      ? { trials: {}, last_sync: null, last_import_summary: null }
      : await loadSyncState()

    // For incremental: only use sinceDate if explicitly provided by the user.
    // Otherwise fetch all trials and rely on shouldSkipTrial to skip already-synced ones.
    const sinceDate = options.sinceDate || undefined

    // Phase 1: Fetch trials from CT.gov
    progress('fetch', 'Fetching trials from ClinicalTrials.gov...', 0, 0)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allStudies: Record<string, any>[] = []

    if (options.nctIds?.length) {
      allStudies = await fetchTrialsByNctIds(options.nctIds, signal)
    } else {
      for (const sponsor of options.sponsors) {
        if (signal.aborted) break
        progress('fetch', `Searching for ${sponsor} trials...`, allStudies.length, 0)
        const studies = await searchTrialsBySponsor(sponsor, {
          sinceDate,
          signal,
        })
        allStudies.push(...studies)
        progress('fetch', `Found ${studies.length} trials for ${sponsor}`, allStudies.length, 0)
      }
    }

    if (signal.aborted) throw new Error('Import cancelled')

    // Deduplicate by NCT ID
    const seen = new Set<string>()
    const uniqueStudies = allStudies.filter((s) => {
      const nctId = s.protocolSection?.identificationModule?.nctId
      if (!nctId || seen.has(nctId)) return false
      seen.add(nctId)
      return true
    })

    // Filter unchanged trials (incremental)
    const studiesToProcess = uniqueStudies.filter((s) => {
      const nctId = s.protocolSection?.identificationModule?.nctId
      const lastUpdate = getLastUpdateDate(s)
      if (shouldSkipTrial(nctId, lastUpdate, syncState)) {
        counts.trials_skipped++
        return false
      }
      return true
    })

    // Apply limit to new trials (not to the CT.gov fetch)
    const limited = options.limit ? studiesToProcess.slice(0, options.limit) : studiesToProcess
    const total = limited.length
    progress('fetch', `${total} trials to process (${counts.trials_skipped} unchanged${options.limit ? `, capped at ${options.limit}` : ''})`, 0, total)

    // Extract all trial data once
    const extractedData = limited.map((study) => extractTrialData(study))

    // Phase 2: Create organizations
    progress('orgs', 'Creating organizations...', 0, total)
    const sponsorNames = new Set<string>()
    for (const data of extractedData) {
      if (data.sponsor) sponsorNames.add(data.sponsor)
      for (const c of data.collaborators) sponsorNames.add(c)
    }
    await createOrganizationsBulk([...sponsorNames], counts)

    // Phase 2b: Ensure all country terms exist before processing sites
    progress('countries', 'Checking country terms...', 0, total)
    const allCountries: string[] = []
    for (const data of extractedData) {
      for (const loc of data.locations) {
        if (loc.country) allCountries.push(loc.country)
      }
    }
    await ensureCountryTerms(allCountries, counts)

    // Phase 2c: Ensure all molecule terms exist before processing trials
    progress('molecules', 'Checking molecule terms...', 0, total)
    const allInterventions: Array<{ name?: string; type?: string }> = []
    for (const data of extractedData) {
      for (const intv of data.interventions_raw) {
        allInterventions.push(intv)
      }
    }
    await ensureMoleculeTerms(allInterventions, counts)

    // Phase 3a: protocol documents — cross-trial accumulate-and-flush (CASE-731).
    // Children carry no reference to the trial doc-id (the `trial` field is
    // dormant; linkage is by nct_id value), so trials/outcomes/sites batch
    // independently. Sync entries are recorded at trial-flush time for
    // non-results trials; results trials are marked in Phase 3b so a failed
    // results fetch leaves them retryable on the next incremental run.
    const trialDocIds = new Map<string, string>()
    const syncMeta = new Map<string, { lastUpdate: string; source: string; hasResults: boolean }>()

    const trialBatcher = new DocBatcher('CT_TRIAL', 'Trial', counts, 'trials_created', 'trials_updated')
    const outcomeBatcher = new DocBatcher('CT_TRIAL_OUTCOME', 'Outcomes', counts, 'outcomes_created', 'outcomes_updated')
    const siteBatcher = new DocBatcher('CT_TRIAL_SITE', 'Sites', counts, 'sites_created', 'sites_updated')

    const flushTrials = async () => {
      const flushed = await trialBatcher.flush()
      if (!flushed.length) return
      for (const r of flushed) {
        if (r.status === 'error' || !r.batchNctId) continue
        const docId = r.document_id || r.id
        if (docId) trialDocIds.set(r.batchNctId, docId)
        const meta = syncMeta.get(r.batchNctId)
        if (meta && !meta.hasResults) {
          updateTrialSyncEntry(syncState, r.batchNctId, meta.lastUpdate, meta.source)
        }
      }
      // Checkpoint at the flush boundary — only fully-flushed trials are marked
      await saveSyncState(syncState)
    }

    for (let i = 0; i < limited.length; i++) {
      if (signal.aborted) throw new Error('Import cancelled')

      const data = extractedData[i]
      const nctId = data.nct_id
      const source = options.nctIds?.length ? 'specific' : (data.sponsor || 'unknown')
      progress('trials', `Preparing ${nctId}...`, i, total, nctId)

      try {
        const trialDoc = buildTrialDoc(data, counts)
        if (!trialDoc) continue
        trialBatcher.add(nctId, [trialDoc])
        syncMeta.set(nctId, {
          lastUpdate: getLastUpdateDate(limited[i]),
          source,
          hasResults: !!data.has_results,
        })
        outcomeBatcher.add(nctId, buildOutcomeDocs(nctId, data.primary_outcomes, data.secondary_outcomes))
        siteBatcher.add(nctId, await buildSiteDocs(nctId, data.locations, counts))
      } catch (err) {
        counts.errors++
        counts.error_log.push(`Trial ${nctId}: ${(err as Error).message}`)
      }

      if (trialBatcher.size >= 100) {
        progress('trials', `Writing trials batch (${i + 1}/${total})...`, i + 1, total, nctId)
        await flushTrials()
      }
      await outcomeBatcher.flushIfFull()
      await siteBatcher.flushIfFull()
    }
    progress('trials', 'Writing final protocol batches...', total, total)
    await flushTrials()
    await outcomeBatcher.flush()
    await siteBatcher.flush()

    // Phase 3b: results + PDFs for trials that have them. Runs strictly after
    // Phase 3a's outcome flush — the enriched outcome docs share identity with
    // the bare ones, and this ordering keeps the results version on top.
    const resultTrials = extractedData.filter((d) => d.has_results && trialDocIds.has(d.nct_id))
    const aeBatcher = new DocBatcher('CT_TRIAL_AE', 'AEs', counts, 'aes_created', 'aes_updated')
    const baselineBatcher = new DocBatcher('CT_TRIAL_BASELINE', 'Baselines', counts, 'baselines_created', 'baselines_updated')
    // Both tallies land in outcomes_updated, matching prior counting semantics
    const outcomeResultBatcher = new DocBatcher('CT_TRIAL_OUTCOME', 'Outcome results', counts, 'outcomes_updated', 'outcomes_updated')
    const fileLinks: Array<{ nctId: string; documentId: string; fileIds: string[] }> = []

    for (let i = 0; i < resultTrials.length; i++) {
      if (signal.aborted) throw new Error('Import cancelled')

      const data = resultTrials[i]
      const nctId = data.nct_id
      progress('results', `Fetching results ${nctId}...`, i, resultTrials.length, nctId)

      try {
        const resultsData = await fetchTrialResultsAndDocs(nctId, signal)
        if (resultsData.resultsSection) {
          const rs = resultsData.resultsSection
          aeBatcher.add(nctId, buildAEDocs(nctId, rs.adverseEventsModule))
          baselineBatcher.add(nctId, buildBaselineDocs(nctId, rs.baselineCharacteristicsModule))
          const outcomeMeasures = rs.outcomeMeasuresModule?.outcomeMeasures
          if (outcomeMeasures) {
            outcomeResultBatcher.add(nctId, buildOutcomeResultDocs(nctId, outcomeMeasures))
          }
        }

        if (!options.skipPdfs && resultsData.documentSection) {
          const fileIds = await downloadAndUploadPdfs(nctId, resultsData.documentSection, counts, signal)
          const documentId = trialDocIds.get(nctId)
          if (fileIds.length > 0 && documentId) {
            fileLinks.push({ nctId, documentId, fileIds })
          }
        }

        // Results fetched — safe to mark synced (write errors are per-item logged)
        const meta = syncMeta.get(nctId)
        if (meta) updateTrialSyncEntry(syncState, nctId, meta.lastUpdate, meta.source)
      } catch (err) {
        counts.errors++
        counts.error_log.push(`Trial ${nctId}: ${(err as Error).message}`)
      }

      await aeBatcher.flushIfFull()
      await baselineBatcher.flushIfFull()
      await outcomeResultBatcher.flushIfFull()

      if ((i + 1) % 50 === 0) {
        progress('results', `Checkpointing sync state (${i + 1}/${resultTrials.length})...`, i + 1, resultTrials.length, nctId)
        await saveSyncState(syncState)
      }

      // Rate limiting for CT.gov
      await sleep(100)
    }

    progress('results', 'Writing final results batches...', resultTrials.length, resultTrials.length)
    await aeBatcher.flush()
    await baselineBatcher.flush()
    await outcomeResultBatcher.flush()
    await linkFilesBulk(fileLinks, counts)

    // Save final sync state
    progress('saving', 'Saving sync state...', total, total)
    syncState.last_import_summary = { ...counts }
    await saveSyncState(syncState, true)

    if (activeJob) activeJob.status = 'completed'
    progress('complete', 'Import complete', total, total)

    return counts
  } catch (err) {
    if (activeJob && activeJob.status === 'running') {
      activeJob.status = 'error'
    }
    throw err
  }
}
