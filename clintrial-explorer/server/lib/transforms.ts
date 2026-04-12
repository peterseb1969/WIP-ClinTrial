/**
 * Data transformation functions for ClinicalTrials.gov data.
 * Ported from scripts/import_trials.py.
 */

import { reportQuery } from './wip-api.js'

/** Load TA keyword map from WIP terminology (term values + labels + aliases) */
export async function loadTAKeywordMap(): Promise<Map<string, Set<string>>> {
  const result = await reportQuery<{ value: string; label: string; aliases: string | null }>(
    `SELECT t.value, t.label, t.aliases
     FROM terms t
     JOIN terminologies tt ON t.terminology_id = tt.terminology_id
     WHERE tt.value = 'CT_THERAPEUTIC_AREA' AND t.status = 'active'`,
  )

  const keywords = new Map<string, Set<string>>()
  for (const row of result.rows) {
    const kw = new Set<string>()
    kw.add(row.value.toLowerCase().replace(/_/g, ' '))
    kw.add(row.label.toLowerCase())
    if (row.aliases) {
      try {
        const aliases = JSON.parse(row.aliases) as string[]
        for (const a of aliases) {
          if (a.length > 2) kw.add(a.toLowerCase())
        }
      } catch {
        // skip invalid JSON
      }
    }
    // Remove very short keywords
    const filtered = new Set([...kw].filter((k) => k.length > 2))
    keywords.set(row.value, filtered)
  }
  return keywords
}

/** Molecule lookup map — loaded dynamically from CT_MOLECULE terminology */
let moleculeMap: Record<string, string> = {}

/** Load molecule map from WIP terminology (term values + labels + aliases) */
export async function loadMoleculeMap(): Promise<void> {
  const result = await reportQuery<{ value: string; label: string; aliases: string | null }>(
    `SELECT t.value, t.label, t.aliases
     FROM terms t
     JOIN terminologies tt ON t.terminology_id = tt.terminology_id
     WHERE tt.value = 'CT_MOLECULE' AND tt.namespace = 'clintrial' AND t.status = 'active'`,
  )

  const map: Record<string, string> = {}
  for (const row of result.rows) {
    const canonical = row.value
    // Map value, label, and all aliases to the canonical term value
    map[canonical.toLowerCase()] = canonical
    map[row.label.toLowerCase()] = canonical
    if (row.aliases) {
      try {
        const aliases = JSON.parse(row.aliases) as string[]
        for (const a of aliases) {
          if (a.trim()) map[a.toLowerCase().trim()] = canonical
        }
      } catch { /* skip invalid JSON */ }
    }
  }
  moleculeMap = map
}

/** Country name/alias to ISO code mapping — loaded dynamically from COUNTRY terminology */
export let COUNTRY_MAP: Record<string, string> = {}

/** Load country map from WIP terminology (term values + labels + aliases) */
export async function loadCountryMap(): Promise<void> {
  const result = await reportQuery<{ value: string; label: string; aliases: string | null }>(
    `SELECT t.value, t.label, t.aliases
     FROM terms t
     JOIN terminologies tt ON t.terminology_id = tt.terminology_id
     WHERE tt.value = 'COUNTRY' AND tt.namespace = 'clintrial' AND t.status = 'active'`,
  )

  const map: Record<string, string> = {}
  for (const row of result.rows) {
    const isoCode = row.value
    map[row.label] = isoCode
    if (row.aliases) {
      try {
        const aliases = JSON.parse(row.aliases) as string[]
        for (const a of aliases) {
          if (a.trim()) map[a.trim()] = isoCode
        }
      } catch { /* skip invalid JSON */ }
    }
  }
  // CT.gov-specific variants not in standard aliases
  map['Turkey (Türkiye)'] = 'TR'
  map['Puerto Rico'] = 'US'
  map['Guam'] = 'US'
  map['Virgin Islands (U.S.)'] = 'US'
  map['American Samoa'] = 'US'
  COUNTRY_MAP = map
}


const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

/** Normalize CT.gov date to YYYY-MM-DD format */
export function normalizeDate(dateStr: string | undefined | null): string | undefined {
  if (!dateStr) return undefined
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  // YYYY-MM format
  if (/^\d{4}-\d{2}$/.test(dateStr)) return `${dateStr}-01`
  // "Month YYYY" format
  const monthYear = dateStr.match(/^(\w+)\s+(\d{4})$/)
  if (monthYear) {
    const mm = MONTHS[monthYear[1].toLowerCase()]
    if (mm) return `${monthYear[2]}-${mm}-01`
  }
  // "Month DD, YYYY" format
  const monthDayYear = dateStr.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/)
  if (monthDayYear) {
    const mm = MONTHS[monthDayYear[1].toLowerCase()]
    if (mm) return `${monthDayYear[3]}-${mm}-${monthDayYear[2].padStart(2, '0')}`
  }
  return undefined
}

/** Extract known molecule names from intervention list */
/** Check if a molecule name is known */
export function isMoleculeKnown(name: string): boolean {
  return !!moleculeMap[name.toLowerCase().trim()]
}

/** Add a newly created molecule to the in-memory map */
export function registerMolecule(value: string, label: string): void {
  moleculeMap[value.toLowerCase()] = value
  moleculeMap[label.toLowerCase()] = value
}

export function resolveMolecules(interventions: Array<{ name?: string }>): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  for (const intervention of interventions) {
    const name = intervention.name || ''
    const nameLower = name.toLowerCase().trim()

    // Try exact match
    if (moleculeMap[nameLower]) {
      const canonical = moleculeMap[nameLower]
      if (!seen.has(canonical)) {
        found.push(canonical)
        seen.add(canonical)
      }
      continue
    }

    // Try matching individual tokens
    for (const token of nameLower.split(/[\s,;/+]+/)) {
      const t = token.trim()
      if (t && moleculeMap[t]) {
        const canonical = moleculeMap[t]
        if (!seen.has(canonical)) {
          found.push(canonical)
          seen.add(canonical)
        }
      }
    }
  }

  return found
}

/** Classify conditions into therapeutic area values using keyword matching.
 * taKeywords: Map of TA value -> Set of lowercase keywords
 */
export function classifyTherapeuticAreas(
  conditions: string[],
  taKeywords: Map<string, Set<string>>,
): string[] {
  if (!conditions.length || taKeywords.size === 0) return []

  const matched = new Set<string>()

  for (const condition of conditions) {
    const condLower = condition.toLowerCase()
    for (const [taValue, keywords] of taKeywords) {
      for (const keyword of keywords) {
        if (keyword.length <= 4) {
          // Word boundary match for short keywords
          try {
            if (new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(condLower)) {
              matched.add(taValue)
              break
            }
          } catch {
            // skip invalid regex
          }
        } else {
          if (condLower.includes(keyword)) {
            matched.add(taValue)
            break
          }
        }
      }
    }
  }

  return [...matched].sort()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

/** Extract and flatten CT.gov study data into WIP trial fields */
export function extractTrialData(study: AnyObj) {
  const proto = study.protocolSection || {}
  const ident = proto.identificationModule || {}
  const statusMod = proto.statusModule || {}
  const design = proto.designModule || {}
  const desc = proto.descriptionModule || {}
  const eligibility = proto.eligibilityModule || {}
  const arms = proto.armsInterventionsModule || {}
  const outcomesMod = proto.outcomesModule || {}
  const contacts = proto.contactsLocationsModule || {}
  const sponsorMod = proto.sponsorCollaboratorsModule || {}

  const nctId = ident.nctId || ''
  const title = ident.officialTitle || ident.briefTitle || ''

  return {
    nct_id: nctId,
    title,
    brief_title: ident.briefTitle,
    acronym: ident.acronym,
    status: statusMod.overallStatus,
    phases: design.phases || [],
    study_type: design.studyType,
    brief_summary: desc.briefSummary,
    enrollment: design.enrollmentInfo?.count,
    start_date: normalizeDate(statusMod.startDateStruct?.date),
    primary_completion_date: normalizeDate(statusMod.primaryCompletionDateStruct?.date),
    completion_date: normalizeDate(statusMod.completionDateStruct?.date),
    sponsor: sponsorMod.leadSponsor?.name,
    collaborators: (sponsorMod.collaborators || [])
      .map((c: AnyObj) => c.name)
      .filter(Boolean),
    interventions_raw: arms.interventions || [],
    conditions: (proto.conditionsModule || {}).conditions || [],
    eligibility_criteria: eligibility.eligibilityCriteria,
    minimum_age: eligibility.minimumAge,
    maximum_age: eligibility.maximumAge,
    sex: eligibility.sex,
    healthy_volunteers: eligibility.healthyVolunteers,
    has_results: study.hasResults || false,
    url: `https://clinicaltrials.gov/study/${nctId}`,
    primary_outcomes: outcomesMod.primaryOutcomes || [],
    secondary_outcomes: outcomesMod.secondaryOutcomes || [],
    locations: contacts.locations || [],
    last_update: statusMod.lastUpdatePostDateStruct?.date || '',
  }
}

/** Extract the lastUpdatePostDate from a CT.gov study */
export function getLastUpdateDate(study: AnyObj): string {
  return study?.protocolSection?.statusModule?.lastUpdatePostDateStruct?.date || ''
}
