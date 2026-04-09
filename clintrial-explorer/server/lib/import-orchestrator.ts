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
  createTrial,
  createOutcomes,
  createSites,
  createAdverseEvents,
  createBaselines,
  updateOutcomesWithResults,
  downloadAndUploadPdfs,
  linkFilesToTrial,
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

    // Phase 3: Process trials
    for (let i = 0; i < limited.length; i++) {
      if (signal.aborted) throw new Error('Import cancelled')

      const data = extractedData[i]
      const nctId = data.nct_id
      const source = options.nctIds?.length ? 'specific' : (data.sponsor || 'unknown')

      progress('trials', `Processing ${nctId}...`, i, total, nctId)

      try {
        // Create trial
        const trialDocId = await createTrial(data, counts)
        if (!trialDocId) continue

        // Create child documents
        await createOutcomes(nctId, data.primary_outcomes, data.secondary_outcomes, counts)
        await createSites(nctId, data.locations, counts)

        // Fetch results and documents if trial has results
        if (data.has_results) {
          const resultsData = await fetchTrialResultsAndDocs(nctId, signal)
          if (resultsData.resultsSection) {
            const aeModule = resultsData.resultsSection.adverseEventsModule
            const baselineModule = resultsData.resultsSection.baselineCharacteristicsModule
            const outcomeMeasures = resultsData.resultsSection.outcomeMeasuresModule?.outcomeMeasures

            await createAdverseEvents(nctId, aeModule, counts)
            await createBaselines(nctId, baselineModule, counts)
            if (outcomeMeasures) {
              await updateOutcomesWithResults(nctId, outcomeMeasures, counts)
            }
          }

          // Download and upload PDFs, then link to trial via PATCH
          if (!options.skipPdfs && resultsData.documentSection) {
            const fileIds = await downloadAndUploadPdfs(nctId, resultsData.documentSection, counts, signal)
            if (fileIds.length > 0) {
              await linkFilesToTrial(nctId, trialDocId, fileIds, counts)
            }
          }
        }

        // Update sync state
        updateTrialSyncEntry(syncState, nctId, getLastUpdateDate(limited[i]), source)
      } catch (err) {
        counts.errors++
        counts.error_log.push(`Trial ${nctId}: ${(err as Error).message}`)
      }

      // Checkpoint every 50 trials
      if ((i + 1) % 50 === 0) {
        progress('trials', `Checkpointing sync state (${i + 1}/${total})...`, i + 1, total, nctId)
        await saveSyncState(syncState)
      }

      // Rate limiting
      await sleep(100)
    }

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
