import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'
import { useSampleCounts } from './useFilteredTrials'
import { useFilteredTrials } from './useFilteredTrials'
import { useTrialFilters } from './useTrialFilters'

export interface EligibilityProfile {
  nct_id: string
  org_study_id?: string
  title: string
  brief_title: string
  status: string
  phases: string
  conditions: string
  interventions: string
  min_age: number | null
  max_age: number | null
  ecog_min: number | null
  ecog_max: number | null
  pregnancy_excluded: boolean | null
  cns_excluded: boolean | null
  autoimmune_excluded: boolean | null
  hiv_excluded: boolean | null
  hbv_excluded: boolean | null
  hcv_excluded: boolean | null
  requires_measurable_disease: boolean | null
  life_expectancy_weeks: number | null
  accepts_healthy_volunteers: boolean | null
  criteria_json: string | null
  eligibility_criteria: string | null
}

export interface Criterion {
  type: 'inclusion' | 'exclusion'
  category: string
  text: string
  structured_value: Record<string, unknown> | null
  semantic_group?: string
}

export interface CategoryMapping {
  raw_category: string
  canonical_category: string
  semantic_group: string | null
}

export interface CriteriaTextEntry {
  text: string
  type: 'inclusion' | 'exclusion'
  trialCount: number
}

export interface SemanticGroupFacet {
  group: string
  label: string
  count: number
  trialCount: number
  categories: { category: string; count: number }[]
  topCriteria: CriteriaTextEntry[]
}

export interface PopulationProfile {
  ageMin?: number
  ageMax?: number
  ecogMax?: number | null
  hivAllowed?: boolean
  autoImmuneAllowed?: boolean
  cnsAllowed?: boolean
  healthyVolunteers?: boolean
  measurableRequired?: boolean
  samplesOnly?: boolean
  eligSearch?: string
}

export function useEligibilityFts(query: string | undefined) {
  return useQuery({
    queryKey: ['clintrial', 'elig-fts-pop', query],
    queryFn: async () => {
      if (!query) return null
      // Search both the AI-extracted criteria_json AND the original eligibility_criteria text
      const r = await reportQuery<{ nct_id: string }>(
        `SELECT DISTINCT nct_id FROM (
           SELECT nct_id FROM clintrial.doc_ct_trial_eligibility__v1
           WHERE criteria_json_tsv @@ plainto_tsquery('english', $1)
           UNION
           SELECT nct_id FROM clintrial.doc_ct_trial__v2
           WHERE eligibility_criteria_tsv @@ plainto_tsquery('english', $1)
         ) combined`,
        [query],
        10000,
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    enabled: !!query && query.length >= 2,
    staleTime: 5 * 60 * 1000,
  })
}

export type MatchStatus = 'confirmed' | 'silent' | 'contradicted'

export interface FieldMatch {
  field: string
  label: string
  status: MatchStatus
  trialValue: string
  requiredValue: string
}

export interface ScoredTrial {
  profile: EligibilityProfile
  criteria: Criterion[]
  matchScore: number
  maxScore: number
  matches: FieldMatch[]
  sampleCount: number
}

export interface OntologyNode {
  value: string
  label: string
  children: { value: string; label: string }[]
}

export function useEligibilityOntology() {
  return useQuery({
    queryKey: ['clintrial', 'eligibility-ontology'],
    queryFn: async () => {
      const r = await reportQuery<{
        term_value: string
        term_label: string
        relation_type: string | null
        target_term_value: string | null
      }>(
        `SELECT t.value as term_value, t.label as term_label,
                tr.relation_type, tr.target_term_value
         FROM terms t
         LEFT JOIN term_relations tr ON tr.source_term_id = t.term_id
         WHERE t.terminology_value = 'CT_SEMANTIC_GROUP'
         ORDER BY t.value`,
        [],
        1000,
      )

      const labels = new Map<string, string>()
      const parentGroups: OntologyNode[] = []
      const childrenMap = new Map<string, { value: string; label: string }[]>()

      // First pass: collect all labels and children
      for (const row of r.rows) {
        labels.set(row.term_value, row.term_label)
        if (row.relation_type === 'part_of' && row.target_term_value) {
          if (!childrenMap.has(row.target_term_value)) childrenMap.set(row.target_term_value, [])
          childrenMap.get(row.target_term_value)!.push({ value: row.term_value, label: row.term_label })
        }
      }

      // Second pass: build parent nodes (terms without a part_of relation = roots)
      const childValues = new Set<string>()
      for (const row of r.rows) {
        if (row.relation_type === 'part_of') childValues.add(row.term_value)
      }
      for (const row of r.rows) {
        if (!childValues.has(row.term_value) && !parentGroups.some((p) => p.value === row.term_value)) {
          parentGroups.push({
            value: row.term_value,
            label: row.term_label,
            children: childrenMap.get(row.term_value) ?? [],
          })
        }
      }

      return { nodes: parentGroups, labels }
    },
    staleTime: 60 * 60 * 1000, // 1 hour — ontology rarely changes
  })
}

// Fallback for when ontology hasn't loaded yet
const FALLBACK_LABELS: Record<string, string> = {
  PRIOR_TREATMENT: 'Prior Treatment', DIAGNOSIS: 'Diagnosis / Disease',
  LAB_VALUES: 'Lab Values / Organ Function', INFECTION: 'Infection',
  UNCLASSIFIED: 'Unclassified',
}

let _ontologyLabels: Map<string, string> | null = null

export function setOntologyLabels(labels: Map<string, string>) {
  _ontologyLabels = labels
}

export function getGroupLabel(group: string): string {
  return _ontologyLabels?.get(group) ?? FALLBACK_LABELS[group] ?? group
}

export function useCategoryMappings() {
  return useQuery({
    queryKey: ['clintrial', 'category-mappings'],
    queryFn: async () => {
      const r = await reportQuery<CategoryMapping>(
        `SELECT raw_category, canonical_category, semantic_group
         FROM doc_ct_elig_category_mapping`,
        [],
        10000,
      )
      const map = new Map<string, CategoryMapping>()
      for (const row of r.rows) {
        map.set(row.raw_category, row)
      }
      return map
    },
    staleTime: 30 * 60 * 1000,
  })
}

export function useEligibilityProfiles() {
  return useQuery({
    queryKey: ['clintrial', 'eligibility-profiles'],
    queryFn: async () => {
      const r = await reportQuery<EligibilityProfile>(
        `SELECT e.nct_id, e.min_age, e.max_age, e.ecog_min, e.ecog_max,
                e.pregnancy_excluded, e.cns_excluded, e.autoimmune_excluded,
                e.hiv_excluded, e.hbv_excluded, e.hcv_excluded,
                e.requires_measurable_disease, e.life_expectancy_weeks,
                e.accepts_healthy_volunteers, e.criteria_json,
                t.title, t.brief_title, t.status, t.phases, t.org_study_id,
                t.conditions, t.interventions, t.eligibility_criteria
         FROM doc_ct_trial_eligibility e
         JOIN doc_ct_trial t ON t.nct_id = e.nct_id`,
        [],
        10000,
      )
      return r.rows
    },
    staleTime: 10 * 60 * 1000,
  })
}

export function parseCriteria(
  criteriaJson: string | null,
  mappings: Map<string, CategoryMapping> | undefined,
): Criterion[] {
  if (!criteriaJson) return []
  try {
    const parsed = JSON.parse(criteriaJson) as Criterion[]
    if (!Array.isArray(parsed)) return []
    if (!mappings) return parsed.filter((c) => c && c.text)
    return parsed
      .filter((c) => c && c.text)
      .map((c) => {
        const mapping = c.category ? mappings.get(c.category) : undefined
        return {
          ...c,
          category: mapping?.canonical_category ?? c.category ?? 'UNKNOWN',
          semantic_group: mapping?.semantic_group ?? undefined,
        }
      })
  } catch {
    return []
  }
}

export function parseArray(val: string | null | undefined): string[] {
  if (!val) return []
  try {
    const parsed = JSON.parse(val)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return val.split(',').map((s) => s.trim()).filter(Boolean)
  }
}

function boolStr(val: boolean | null | undefined): string {
  if (val === true) return 'Yes'
  if (val === false) return 'No'
  return '—'
}

function scoreTrial(
  profile: EligibilityProfile,
  criteria: Criterion[],
  search: PopulationProfile,
  sampleCount: number,
): ScoredTrial {
  const matches: FieldMatch[] = []

  function check(
    field: string,
    label: string,
    trialVal: boolean | null | undefined,
    wantExcluded: boolean,
  ) {
    const tv = boolStr(trialVal)
    const rv = wantExcluded ? 'Excluded' : 'Allowed'
    if (trialVal === null || trialVal === undefined) {
      matches.push({ field, label, status: 'silent', trialValue: tv, requiredValue: rv })
    } else if (trialVal === wantExcluded) {
      matches.push({ field, label, status: 'confirmed', trialValue: tv, requiredValue: rv })
    } else {
      matches.push({ field, label, status: 'contradicted', trialValue: tv, requiredValue: rv })
    }
  }

  if (search.ecogMax !== undefined && search.ecogMax !== null) {
    const tv = profile.ecog_max
    if (tv === null || tv === undefined) {
      matches.push({ field: 'ecog_max', label: 'ECOG', status: 'silent', trialValue: '—', requiredValue: `≤${search.ecogMax}` })
    } else if (tv <= search.ecogMax) {
      matches.push({ field: 'ecog_max', label: 'ECOG', status: 'confirmed', trialValue: `0-${tv}`, requiredValue: `≤${search.ecogMax}` })
    } else {
      matches.push({ field: 'ecog_max', label: 'ECOG', status: 'contradicted', trialValue: `0-${tv}`, requiredValue: `≤${search.ecogMax}` })
    }
  }

  if (search.ageMin !== undefined) {
    const tv = profile.min_age
    if (tv === null || tv === undefined) {
      matches.push({ field: 'min_age', label: 'Min Age', status: 'silent', trialValue: '—', requiredValue: `≥${search.ageMin}` })
    } else if (tv <= search.ageMin) {
      matches.push({ field: 'min_age', label: 'Min Age', status: 'confirmed', trialValue: `${tv}`, requiredValue: `≥${search.ageMin}` })
    } else {
      matches.push({ field: 'min_age', label: 'Min Age', status: 'contradicted', trialValue: `${tv}`, requiredValue: `≥${search.ageMin}` })
    }
  }

  if (search.ageMax !== undefined) {
    const tv = profile.max_age
    if (tv === null || tv === undefined) {
      matches.push({ field: 'max_age', label: 'Max Age', status: 'silent', trialValue: '—', requiredValue: `≤${search.ageMax}` })
    } else if (tv >= search.ageMax) {
      matches.push({ field: 'max_age', label: 'Max Age', status: 'confirmed', trialValue: `${tv}`, requiredValue: `≤${search.ageMax}` })
    } else {
      matches.push({ field: 'max_age', label: 'Max Age', status: 'contradicted', trialValue: `${tv}`, requiredValue: `≤${search.ageMax}` })
    }
  }

  if (search.hivAllowed !== undefined) check('hiv_excluded', 'HIV', profile.hiv_excluded, !search.hivAllowed)
  if (search.autoImmuneAllowed !== undefined) check('autoimmune_excluded', 'Autoimmune', profile.autoimmune_excluded, !search.autoImmuneAllowed)
  if (search.cnsAllowed !== undefined) check('cns_excluded', 'CNS Mets', profile.cns_excluded, !search.cnsAllowed)
  if (search.healthyVolunteers !== undefined) check('accepts_healthy_volunteers', 'Healthy Vol.', profile.accepts_healthy_volunteers, search.healthyVolunteers)
  if (search.measurableRequired !== undefined) check('requires_measurable_disease', 'Measurable', profile.requires_measurable_disease, search.measurableRequired)

  const maxScore = matches.length
  const matchScore = matches.reduce((sum, m) => sum + (m.status === 'confirmed' ? 1 : m.status === 'contradicted' ? -1 : 0), 0)

  return { profile, criteria, matchScore, maxScore, matches, sampleCount }
}

export function usePopulationSearch(search: PopulationProfile) {
  const { data: profiles, isLoading: profilesLoading } = useEligibilityProfiles()
  const { data: sampleCounts } = useSampleCounts()
  const { data: mappings } = useCategoryMappings()
  const { trials: globalFiltered } = useFilteredTrials()
  const { filters } = useTrialFilters()
  const { data: ftsNctIds } = useEligibilityFts(search.eligSearch)

  const hasGlobalFilters = !!(
    filters.molecule?.length || filters.condition?.length || filters.therapeutic_area?.length ||
    filters.phase?.length || filters.status?.length || filters.sponsor?.length
  )

  const globalNctIds = useMemo(() => {
    if (!hasGlobalFilters) return null
    return new Set(globalFiltered.map((t) => t.data.nct_id))
  }, [globalFiltered, hasGlobalFilters])

  const results = useMemo(() => {
    if (!profiles) return []

    const samplesSet = sampleCounts ? new Set(sampleCounts.keys()) : new Set<string>()

    let filtered = profiles

    if (globalNctIds) {
      filtered = filtered.filter((p) => globalNctIds.has(p.nct_id))
    }

    if (search.samplesOnly) {
      filtered = filtered.filter((p) => samplesSet.has(p.nct_id))
    }

    if (search.eligSearch && ftsNctIds) {
      filtered = filtered.filter((p) => ftsNctIds.has(p.nct_id))
    }

    const scored = filtered.map((p) => {
      const criteria = parseCriteria(p.criteria_json, mappings)
      return scoreTrial(p, criteria, search, sampleCounts?.get(p.nct_id) ?? 0)
    })

    scored.sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore
      if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount
      return 0
    })

    return scored
  }, [profiles, sampleCounts, mappings, globalNctIds, ftsNctIds, search])

  const facets = useMemo(() => {
    const groupMap = new Map<string, {
      count: number
      trials: Set<string>
      categories: Map<string, number>
      textCounts: Map<string, { type: 'inclusion' | 'exclusion'; trials: Set<string> }>
    }>()

    for (const trial of results) {
      for (const c of trial.criteria) {
        const g = c.semantic_group ?? 'UNCLASSIFIED'
        let entry = groupMap.get(g)
        if (!entry) {
          entry = { count: 0, trials: new Set(), categories: new Map(), textCounts: new Map() }
          groupMap.set(g, entry)
        }
        entry.count++
        entry.trials.add(trial.profile.nct_id)
        entry.categories.set(c.category, (entry.categories.get(c.category) ?? 0) + 1)

        // Collect criteria text (truncate to 120 chars for dedup key)
        if (!c.text) continue
        const textKey = c.text.slice(0, 120).toLowerCase().trim()
        let textEntry = entry.textCounts.get(textKey)
        if (!textEntry) {
          textEntry = { type: c.type, trials: new Set() }
          entry.textCounts.set(textKey, textEntry)
        }
        textEntry.trials.add(trial.profile.nct_id)
      }
    }

    const facetList: SemanticGroupFacet[] = []
    for (const [group, data] of groupMap) {
      const topCriteria: CriteriaTextEntry[] = [...data.textCounts.entries()]
        .map(([text, info]) => ({ text, type: info.type, trialCount: info.trials.size }))
        .sort((a, b) => b.trialCount - a.trialCount)
        .slice(0, 50)

      facetList.push({
        group,
        label: getGroupLabel(group),
        count: data.count,
        trialCount: data.trials.size,
        categories: [...data.categories.entries()]
          .map(([cat, cnt]) => ({ category: cat, count: cnt }))
          .sort((a, b) => b.count - a.count),
        topCriteria,
      })
    }
    facetList.sort((a, b) => b.count - a.count)
    return facetList
  }, [results])

  return { results, facets, isLoading: profilesLoading, totalProfiles: profiles?.length ?? 0 }
}
