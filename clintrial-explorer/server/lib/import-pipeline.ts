/**
 * Document creation functions for the import pipeline.
 * Ported from scripts/import_trials.py.
 */

import {
  resolveTemplateIds,
  createDocumentsBulk,
  wipUploadFile,
  wipPatch,
  reportQuery,
  clearTemplateCache,
  resolveTerminologyId,
  createTerms,
  type BulkResult,
} from './wip-api.js'
import {
  COUNTRY_MAP,
  resolveMolecules,
  classifyTherapeuticAreas,
  loadTAKeywordMap,
  loadMoleculeMap,
  loadCountryMap,
} from './transforms.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

/** Template IDs resolved at pipeline start */
let TEMPLATES: Record<string, string> = {}

/** Organization name -> document_id cache */
const ORG_DOC_IDS = new Map<string, string>()

/** TA keyword map for classification */
let taKeywords: Map<string, Set<string>> = new Map()

/** Pinned trial TAs — loaded before import, restored after */
let pinnedTrials: Map<string, string[]> = new Map()

/** Known valid country term values — populated from WIP at pipeline init */
let knownCountryTerms: Set<string> = new Set()
let countryTerminologyId: string | null = null

export interface ImportCounts {
  orgs_created: number
  orgs_updated: number
  trials_created: number
  trials_updated: number
  trials_skipped: number
  outcomes_created: number
  outcomes_updated: number
  sites_created: number
  sites_updated: number
  aes_created: number
  aes_updated: number
  baselines_created: number
  baselines_updated: number
  files_uploaded: number
  errors: number
  error_log: string[]
  warnings: number
  warning_log: string[]
}

const MAX_ERROR_LOG = 200
const MAX_WARNING_LOG = 200

function logError(counts: ImportCounts, message: string) {
  counts.errors++
  if (counts.error_log.length < MAX_ERROR_LOG) {
    counts.error_log.push(message)
  }
}

function logWarning(counts: ImportCounts, message: string) {
  counts.warnings++
  if (counts.warning_log.length < MAX_WARNING_LOG) {
    counts.warning_log.push(message)
  }
}

function logBulkErrors(counts: ImportCounts, context: string, results: BulkResult[]) {
  for (const item of results) {
    if (item.status === 'error') {
      logError(counts, `${context}: ${item.error || item.message || 'unknown error'}`)
    }
  }
}

export function newCounts(): ImportCounts {
  return {
    orgs_created: 0, orgs_updated: 0,
    trials_created: 0, trials_updated: 0, trials_skipped: 0,
    outcomes_created: 0, outcomes_updated: 0,
    sites_created: 0, sites_updated: 0,
    aes_created: 0, aes_updated: 0,
    baselines_created: 0, baselines_updated: 0,
    files_uploaded: 0, errors: 0, error_log: [],
    warnings: 0, warning_log: [],
  }
}

/** Initialize the pipeline — resolve templates, load TA keywords, load pinned trials */
export async function initPipeline(): Promise<void> {
  TEMPLATES = await resolveTemplateIds([
    'CT_ORGANIZATION',
    'CT_TRIAL',
    'CT_TRIAL_OUTCOME',
    'CT_TRIAL_SITE',
    'CT_TRIAL_AE',
    'CT_TRIAL_BASELINE',
  ])

  // Load lookup maps from WIP terminologies
  await Promise.all([
    loadTAKeywords(),
    loadMoleculeMap().catch((err) => console.warn('Could not load molecule map:', err)),
    loadCountryMap().catch((err) => console.warn('Could not load country map:', err)),
  ])

  // Load pinned trials
  await loadPinnedTrials()

  // Load known country terms
  await loadCountryTerms()
}

async function loadTAKeywords(): Promise<void> {
  try {
    taKeywords = await loadTAKeywordMap()
  } catch (err) {
    console.warn('Could not load TA keywords:', err)
  }
}

async function loadPinnedTrials(): Promise<void> {
  try {
    const result = await reportQuery<{ nct_id: string; therapeutic_areas: string | null }>(
      `SELECT nct_id, therapeutic_areas FROM doc_ct_trial WHERE ta_pinned = true AND status = 'active'`,
    )
    pinnedTrials = new Map()
    for (const row of result.rows) {
      const tas = row.therapeutic_areas ? JSON.parse(row.therapeutic_areas) : []
      pinnedTrials.set(row.nct_id, tas)
    }
  } catch (err) {
    console.warn('Could not load pinned trials:', err)
  }
}

async function loadCountryTerms(): Promise<void> {
  try {
    countryTerminologyId = await resolveTerminologyId('COUNTRY')
    const result = await reportQuery<{ value: string }>(
      `SELECT t.value FROM terms t
       JOIN terminologies tt ON t.terminology_id = tt.terminology_id
       WHERE tt.value = 'COUNTRY' AND tt.namespace = 'clintrial' AND t.status = 'active'`,
    )
    knownCountryTerms = new Set(result.rows.map((r) => r.value))
  } catch (err) {
    console.warn('Could not load country terms:', err)
  }
}

/** Look up a CT.gov country name → valid COUNTRY term value. No auto-create. */
function resolveCountry(rawCountry: string, counts: ImportCounts): string | null {
  const mapped = COUNTRY_MAP[rawCountry]
  const candidates = mapped ? [mapped, rawCountry] : [rawCountry]
  for (const candidate of candidates) {
    if (knownCountryTerms.has(candidate)) return candidate
  }
  logError(counts, `Sites: Unknown country '${rawCountry}' not in COUNTRY terminology`)
  return null
}

/** Pre-scan all studies for unknown countries, batch-create missing terms, and wait for cache.
 *  Call this ONCE before processing trials, not per-site. */
export async function ensureCountryTerms(
  rawCountries: string[],
  counts: ImportCounts,
): Promise<void> {
  if (!countryTerminologyId) return

  const missing: Array<{ value: string; label: string; aliases?: string[] }> = []
  const seen = new Set<string>()

  for (const raw of rawCountries) {
    if (seen.has(raw)) continue
    seen.add(raw)

    const mapped = COUNTRY_MAP[raw]
    const candidates = mapped ? [mapped, raw] : [raw]
    const found = candidates.some((c) => knownCountryTerms.has(c))
    if (found) continue

    if (mapped) {
      missing.push({ value: mapped, label: raw, aliases: [raw] })
      logWarning(counts, `Auto-created country term '${mapped}' (${raw}) — verify in COUNTRY terminology`)
    } else {
      missing.push({ value: raw, label: raw })
      logWarning(counts, `Auto-created country term '${raw}' (no ISO code in COUNTRY_MAP) — add mapping to transforms.ts`)
    }
  }

  if (!missing.length) return

  try {
    await createTerms(countryTerminologyId, missing)
    for (const t of missing) knownCountryTerms.add(t.value)
  } catch (err) {
    logError(counts, `Failed to batch-create country terms: ${(err as Error).message}`)
  }
}

/** Create organizations in bulk. Caches document IDs. */
export async function createOrganizationsBulk(
  orgNames: string[],
  counts: ImportCounts,
): Promise<void> {
  if (!orgNames.length) return

  const unique = [...new Set(orgNames)]
  const dataList = unique.map((name) => ({ org_name: name, org_type: 'Sponsor' }))

  const result = await createDocumentsBulk(TEMPLATES.CT_ORGANIZATION, dataList)

  for (let i = 0; i < result.results.length; i++) {
    const r = result.results[i]
    const docId = r.document_id || r.id
    if (docId && i < unique.length) {
      ORG_DOC_IDS.set(unique[i], docId)
    }
  }

  counts.orgs_created += result.created
  counts.orgs_updated += result.updated
  logBulkErrors(counts, 'Org creation', result.results)
}

/** Create a single trial document. Returns document_id if successful, null on failure. */
export async function createTrial(
  trialData: AnyObj,
  counts: ImportCounts,
): Promise<string | null> {
  const sponsorName = trialData.sponsor
  const sponsorDocId = ORG_DOC_IDS.get(sponsorName)
  if (!sponsorDocId) {
    logError(counts, `Trial ${trialData.nct_id}: no document_id for sponsor '${sponsorName}'`)
    return null
  }

  const data: AnyObj = {
    nct_id: trialData.nct_id,
    title: trialData.title,
    status: trialData.status,
    study_type: trialData.study_type,
    sponsor: sponsorDocId,
  }

  // Optional string fields
  for (const field of [
    'brief_title', 'acronym', 'brief_summary',
    'eligibility_criteria', 'minimum_age', 'maximum_age', 'sex',
  ]) {
    if (trialData[field] != null) data[field] = trialData[field]
  }

  // healthy_volunteers — CT.gov returns bool, WIP expects string
  if (trialData.healthy_volunteers != null) {
    data.healthy_volunteers = trialData.healthy_volunteers ? 'Yes' : 'No'
  }

  // Date fields
  for (const f of ['start_date', 'primary_completion_date', 'completion_date']) {
    if (trialData[f]) data[f] = trialData[f]
  }

  // Integer fields
  if (trialData.enrollment != null) data.enrollment = trialData.enrollment

  // Boolean fields
  data.has_results = trialData.has_results ?? false

  // Arrays
  if (trialData.phases?.length) data.phases = trialData.phases
  if (trialData.conditions?.length) data.conditions = trialData.conditions
  if (trialData.collaborators?.length) data.collaborators = trialData.collaborators

  // Interventions — resolve to known molecules
  const molecules = resolveMolecules(trialData.interventions_raw || [])
  if (molecules.length) data.interventions = molecules

  // URL
  if (trialData.url) data.ctgov_url = trialData.url

  // Therapeutic areas — check if pinned first
  if (pinnedTrials.has(trialData.nct_id)) {
    data.therapeutic_areas = pinnedTrials.get(trialData.nct_id)
    data.ta_pinned = true
  } else {
    const tas = classifyTherapeuticAreas(trialData.conditions || [], taKeywords)
    if (tas.length) data.therapeutic_areas = tas
  }

  const result = await createDocumentsBulk(TEMPLATES.CT_TRIAL, [data])
  if (result.created > 0) counts.trials_created++
  else if (result.updated > 0) counts.trials_updated++
  else logBulkErrors(counts, `Trial ${trialData.nct_id}`, result.results)

  const docId = result.results[0]?.document_id || result.results[0]?.id || null
  return result.errors === 0 ? docId : null
}

/** Create outcome documents for a trial */
export async function createOutcomes(
  nctId: string,
  primaryOutcomes: AnyObj[],
  secondaryOutcomes: AnyObj[],
  counts: ImportCounts,
): Promise<void> {
  const dataList: AnyObj[] = []

  for (let i = 0; i < primaryOutcomes.length; i++) {
    const o = primaryOutcomes[i]
    if (!o.measure) continue
    const d: AnyObj = {
      nct_id: nctId,
      outcome_type: 'PRIMARY',
      sequence: i + 1,
      measure: o.measure,
    }
    if (o.timeFrame) d.time_frame = o.timeFrame
    if (o.description) d.description = o.description
    dataList.push(d)
  }

  for (let i = 0; i < secondaryOutcomes.length; i++) {
    const o = secondaryOutcomes[i]
    if (!o.measure) continue
    const d: AnyObj = {
      nct_id: nctId,
      outcome_type: 'SECONDARY',
      sequence: i + 1,
      measure: o.measure,
    }
    if (o.timeFrame) d.time_frame = o.timeFrame
    if (o.description) d.description = o.description
    dataList.push(d)
  }

  if (!dataList.length) return

  const result = await createDocumentsBulk(TEMPLATES.CT_TRIAL_OUTCOME, dataList)
  counts.outcomes_created += result.created
  counts.outcomes_updated += result.updated
  logBulkErrors(counts, `Outcomes ${nctId}`, result.results)
}

/** Create site documents for a trial */
export async function createSites(
  nctId: string,
  locations: AnyObj[],
  counts: ImportCounts,
  maxSites = 20,
): Promise<void> {
  const dataList: AnyObj[] = []

  for (const loc of locations.slice(0, maxSites)) {
    const facility = loc.facility
    if (!facility) continue

    if (!loc.country) continue // country is mandatory
    const cc = await resolveCountry(loc.country, counts)
    if (!cc) continue
    const d: AnyObj = {
      nct_id: nctId,
      facility,
      country: cc,
    }
    if (loc.city) d.city = loc.city
    if (loc.state) d.state = loc.state
    if (loc.zip) d.zip = loc.zip
    if (loc.status) d.site_status = loc.status
    dataList.push(d)
  }

  if (!dataList.length) return

  const result = await createDocumentsBulk(TEMPLATES.CT_TRIAL_SITE, dataList)
  counts.sites_created += result.created
  counts.sites_updated += result.updated
  logBulkErrors(counts, `Sites ${nctId}`, result.results)
}

/** Create adverse event documents */
export async function createAdverseEvents(
  nctId: string,
  aeModule: AnyObj | undefined,
  counts: ImportCounts,
): Promise<void> {
  if (!aeModule) return

  const groupTitles: Record<string, string> = {}
  for (const g of aeModule.eventGroups || []) {
    groupTitles[g.id] = g.title || ''
  }

  const dataList: AnyObj[] = []
  for (const [category, eventsKey] of [
    ['SERIOUS', 'seriousEvents'],
    ['OTHER', 'otherEvents'],
  ] as const) {
    for (const event of aeModule[eventsKey] || []) {
      const term = event.term
      if (!term) continue

      const stats = (event.stats || []).map((s: AnyObj) => ({
        group_id: s.groupId || '',
        group_title: groupTitles[s.groupId] || '',
        ...(s.numEvents != null ? { num_events: s.numEvents } : {}),
        ...(s.numAffected != null ? { num_affected: s.numAffected } : {}),
        ...(s.numAtRisk != null ? { num_at_risk: s.numAtRisk } : {}),
      }))

      const d: AnyObj = { nct_id: nctId, ae_category: category, term, stats }
      if (event.organSystem) d.organ_system = event.organSystem
      if (event.sourceVocabulary) d.source_vocabulary = event.sourceVocabulary
      dataList.push(d)
    }
  }

  if (!dataList.length) return

  const result = await createDocumentsBulk(TEMPLATES.CT_TRIAL_AE, dataList)
  counts.aes_created += result.created
  counts.aes_updated += result.updated
  logBulkErrors(counts, `AEs ${nctId}`, result.results)
}

/** Create baseline characteristic documents */
export async function createBaselines(
  nctId: string,
  baselineModule: AnyObj | undefined,
  counts: ImportCounts,
): Promise<void> {
  if (!baselineModule) return

  const groupTitles: Record<string, string> = {}
  for (const g of baselineModule.groups || []) {
    groupTitles[g.id] = g.title || ''
  }

  const dataList: AnyObj[] = []
  for (const measure of baselineModule.measures || []) {
    const title = measure.title
    if (!title) continue

    const d: AnyObj = { nct_id: nctId, measure_title: title }
    if (measure.paramType) d.param_type = measure.paramType
    if (measure.dispersionType) d.dispersion_type = measure.dispersionType
    if (measure.unitOfMeasure) d.unit_of_measure = measure.unitOfMeasure

    const categories: AnyObj[] = []
    for (const cls of measure.classes || []) {
      for (const cat of cls.categories || []) {
        const catData: AnyObj = {}
        if (cat.title) catData.title = cat.title
        const measurements = (cat.measurements || []).map((m: AnyObj) => ({
          group_id: m.groupId || '',
          group_title: groupTitles[m.groupId] || '',
          ...(m.value != null ? { value: String(m.value) } : {}),
          ...(m.spread != null ? { spread: String(m.spread) } : {}),
          ...(m.lowerLimit != null ? { lower_limit: String(m.lowerLimit) } : {}),
          ...(m.upperLimit != null ? { upper_limit: String(m.upperLimit) } : {}),
        }))
        catData.measurements = measurements
        categories.push(catData)
      }
    }
    if (categories.length) d.categories = categories
    dataList.push(d)
  }

  if (!dataList.length) return

  const result = await createDocumentsBulk(TEMPLATES.CT_TRIAL_BASELINE, dataList)
  counts.baselines_created += result.created
  counts.baselines_updated += result.updated
  logBulkErrors(counts, `Baselines ${nctId}`, result.results)
}

/** Update outcome documents with numeric results data */
export async function updateOutcomesWithResults(
  nctId: string,
  resultsOutcomes: AnyObj[],
  counts: ImportCounts,
): Promise<void> {
  if (!resultsOutcomes?.length) return

  const dataList: AnyObj[] = []
  for (const om of resultsOutcomes) {
    let otype = (om.type || '').toUpperCase()
    if (!['PRIMARY', 'SECONDARY'].includes(otype)) otype = 'OTHER'

    const groupTitles: Record<string, string> = {}
    for (const g of om.groups || []) {
      groupTitles[g.id] = g.title || ''
    }

    const resultGroups: AnyObj[] = []
    for (const cls of om.classes || []) {
      for (const cat of cls.categories || []) {
        for (const m of cat.measurements || []) {
          const rg: AnyObj = {
            group_id: m.groupId || '',
            group_title: groupTitles[m.groupId] || '',
          }
          if (m.value != null) rg.value = String(m.value)
          if (m.spread != null) rg.spread = String(m.spread)
          if (m.lowerLimit != null) rg.lower_limit = String(m.lowerLimit)
          if (m.upperLimit != null) rg.upper_limit = String(m.upperLimit)
          if (m.numSubjects) rg.num_subjects = String(m.numSubjects)
          resultGroups.push(rg)
        }
      }
    }

    const analyses: AnyObj[] = []
    for (const a of om.analyses || []) {
      const analysis: AnyObj = {}
      if (a.groupIds) analysis.group_ids = a.groupIds
      if (a.pValue) analysis.p_value = a.pValue
      if (a.statisticalMethod) analysis.statistical_method = a.statisticalMethod
      if (a.nonInferiorityType) analysis.non_inferiority_type = a.nonInferiorityType
      if (Object.keys(analysis).length) analyses.push(analysis)
    }

    const measure = om.title || ''
    if (!measure) continue

    const sameType = resultsOutcomes.filter(
      (o) => (o.type || '').toUpperCase() === otype || (!['PRIMARY', 'SECONDARY'].includes((o.type || '').toUpperCase()) && otype === 'OTHER'),
    )
    const seq = sameType.indexOf(om) + 1

    const d: AnyObj = {
      nct_id: nctId,
      outcome_type: otype,
      sequence: seq,
      measure,
    }
    if (om.timeFrame) d.time_frame = om.timeFrame
    if (om.description) d.description = om.description
    if (om.paramType) d.param_type = om.paramType
    if (om.dispersionType) d.dispersion_type = om.dispersionType
    if (om.unitOfMeasure) d.unit_of_measure = om.unitOfMeasure
    if (resultGroups.length) d.result_groups = resultGroups
    if (analyses.length) d.analyses = analyses
    dataList.push(d)
  }

  if (!dataList.length) return

  const result = await createDocumentsBulk(TEMPLATES.CT_TRIAL_OUTCOME, dataList)
  counts.outcomes_updated += result.created + result.updated
  logBulkErrors(counts, `Outcome results ${nctId}`, result.results)
}

/** Download and upload PDFs from CT.gov */
export async function downloadAndUploadPdfs(
  nctId: string,
  docSection: AnyObj | undefined,
  counts: ImportCounts,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!docSection) return []

  const largeDocs = docSection.largeDocumentModule?.largeDocs || []
  if (!largeDocs.length) return []

  const nctNum = nctId.replace('NCT', '')
  const last2 = nctNum.slice(-2)
  const fileIds: string[] = []

  for (const doc of largeDocs) {
    if (signal?.aborted) break
    const filename = doc.filename
    if (!filename) continue
    const typeAbbrev = doc.typeAbbrev || ''
    if (!['Prot', 'SAP', 'ICF'].some((t) => typeAbbrev.includes(t))) continue

    const downloadUrl = `https://cdn.clinicaltrials.gov/large-docs/${last2}/${nctId}/${filename}`
    try {
      const resp = await fetch(downloadUrl, { signal })
      if (!resp.ok) continue

      const buffer = Buffer.from(await resp.arrayBuffer())
      const category = typeAbbrev.toLowerCase().replace(/[^a-z]/g, '')

      const result = await wipUploadFile(buffer, filename, {
        description: `${typeAbbrev} for ${nctId}`,
        tags: `${category},${nctId}`,
        category,
        allowedTemplates: 'CT_TRIAL',
      })

      fileIds.push(result.file_id)
      counts.files_uploaded++
    } catch (err) {
      logError(counts, `PDF ${nctId}/${filename}: ${(err as Error).message}`)
    }
  }

  return fileIds
}

/** Link uploaded file IDs to a trial via PATCH (update_document) */
export async function linkFilesToTrial(
  nctId: string,
  documentId: string,
  fileIds: string[],
  counts: ImportCounts,
): Promise<void> {
  try {
    await wipPatch('/api/document-store/documents', [{
      document_id: documentId,
      patch: { documents: fileIds },
    }])
  } catch (err) {
    logError(counts, `Link files to ${nctId}: ${(err as Error).message}`)
  }
}

/** Get the org document ID cache */
export function getOrgDocId(orgName: string): string | undefined {
  return ORG_DOC_IDS.get(orgName)
}

/** Clear caches (for fresh imports) */
export function clearCaches(): void {
  ORG_DOC_IDS.clear()
  taKeywords = new Map()
  pinnedTrials = new Map()
  knownCountryTerms = new Set()
  countryTerminologyId = null
  TEMPLATES = {}
  clearTemplateCache()
}
