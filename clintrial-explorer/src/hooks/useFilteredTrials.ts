import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAllTrials, useTrialsByCountries, type TrialDocument } from './useAllTrials'
import { useTrialFilters } from './useTrialFilters'
import { useGlobalSearch } from './useGlobalSearch'
import { useBookmarks } from './useBookmarks'
import { useClassificationRules, enrichTherapeuticAreas, useTAAncestors } from './useClassificationRules'
import { reportQuery } from '@/lib/reporting'


/** Map of NCT IDs to total in-circulation sample counts (for trials table + dashboard) */
export function useSampleCounts() {
  return useQuery({
    queryKey: ['clintrial', 'sample-counts'],
    queryFn: async () => {
      const result = await reportQuery<{ nct_id: string; samples: number }>(
        `SELECT t.nct_id, SUM(s.available)::INT AS samples
         FROM doc_ct_sami_study_summary s
         JOIN doc_ct_trial t ON t.org_study_id = s.study_number
         WHERE s.source_system = 'SAMI'
         GROUP BY t.nct_id`,
        [],
        10000,
      )
      const map = new Map<string, number>()
      for (const row of result.rows) {
        map.set(row.nct_id, row.samples)
      }
      return map
    },
    staleTime: 10 * 60 * 1000,
  })
}

/** Pre-compute sets of NCT IDs that have related data (AE, outcomes, baselines) */
function useDataAvailability() {
  const { data: aeNctIds } = useQuery({
    queryKey: ['clintrial', 'has-ae'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_ae',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: outcomeNctIds } = useQuery({
    queryKey: ['clintrial', 'has-outcomes'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_outcome',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: baselineNctIds } = useQuery({
    queryKey: ['clintrial', 'has-baseline'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_baseline',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: protocolNctIds } = useQuery({
    queryKey: ['clintrial', 'has-protocol'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        "SELECT DISTINCT nct_id FROM doc_ct_trial WHERE file_references_json IS NOT NULL AND file_references_json != '[]'",
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: samplesNctIds } = useQuery({
    queryKey: ['clintrial', 'has-samples'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        `SELECT DISTINCT nct_id FROM doc_ct_trial
         WHERE org_study_id IN (SELECT DISTINCT study_number FROM doc_ct_sami_study_summary WHERE available > 0)
         AND nct_id IS NOT NULL`,
        [],
        10000,
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  return { aeNctIds, outcomeNctIds, baselineNctIds, protocolNctIds, samplesNctIds }
}

/** Pre-compute sets of NCT IDs by eligibility criteria */
function useEligibilityAvailability() {
  const { data: eligNctIds } = useQuery({
    queryKey: ['clintrial', 'has-eligibility'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_eligibility',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: pregnancyExcluded } = useQuery({
    queryKey: ['clintrial', 'elig-pregnancy-excluded'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_eligibility WHERE pregnancy_excluded = true',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: cnsExcluded } = useQuery({
    queryKey: ['clintrial', 'elig-cns-excluded'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_eligibility WHERE cns_excluded = true',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: hivExcluded } = useQuery({
    queryKey: ['clintrial', 'elig-hiv-excluded'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_eligibility WHERE hiv_excluded = true',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: autoExcluded } = useQuery({
    queryKey: ['clintrial', 'elig-autoimmune-excluded'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_eligibility WHERE autoimmune_excluded = true',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: measurableRequired } = useQuery({
    queryKey: ['clintrial', 'elig-measurable'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_eligibility WHERE requires_measurable_disease = true',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  const { data: healthyVol } = useQuery({
    queryKey: ['clintrial', 'elig-healthy-volunteers'],
    queryFn: async () => {
      const r = await reportQuery<{ nct_id: string }>(
        'SELECT DISTINCT nct_id FROM doc_ct_trial_eligibility WHERE accepts_healthy_volunteers = true',
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    staleTime: 10 * 60 * 1000,
  })

  return { eligNctIds, pregnancyExcluded, cnsExcluded, hivExcluded, autoExcluded, measurableRequired, healthyVol }
}

/** Full-text search on eligibility criteria_json — returns matching NCT IDs ranked by relevance */
function useEligibilitySearch(query: string | undefined) {
  return useQuery({
    queryKey: ['clintrial', 'elig-fts', query],
    queryFn: async () => {
      if (!query) return null
      const r = await reportQuery<{ nct_id: string }>(
        `SELECT nct_id FROM clintrial.doc_ct_trial_eligibility__v1
         WHERE criteria_json_tsv @@ plainto_tsquery('english', $1)
         ORDER BY ts_rank(criteria_json_tsv, plainto_tsquery('english', $1)) DESC`,
        [query],
        10000,
      )
      return new Set(r.rows.map((row) => row.nct_id))
    },
    enabled: !!query && query.length >= 2,
    staleTime: 5 * 60 * 1000,
  })
}

/** Returns all trials with therapeutic areas enriched by classification rules,
 * then filtered by the current global filter state. */
export function useFilteredTrials() {
  const { data: trials, isLoading, error, refetch } = useAllTrials()
  const { data: rules } = useClassificationRules()
  const { data: ancestorMap } = useTAAncestors()
  const { filters } = useTrialFilters()
  const { has: isBookmarked } = useBookmarks()
  const { data: countryNctIds } = useTrialsByCountries(filters.country)
  const { aeNctIds, outcomeNctIds, baselineNctIds, protocolNctIds, samplesNctIds } = useDataAvailability()
  const { eligNctIds, pregnancyExcluded, cnsExcluded, hivExcluded, autoExcluded, measurableRequired, healthyVol } = useEligibilityAvailability()
  const { data: eligSearchNctIds } = useEligibilitySearch(filters.elig_search)
  const { data: globalSearchResult } = useGlobalSearch(filters.fts_search)
  // Enrich trials with rule-based TA classification and ontology ancestor walk
  const enrichedTrials = useMemo<TrialDocument[] | undefined>(() => {
    if (!trials) return undefined
    const hasRules = rules && rules.length > 0
    const hasOntology = ancestorMap && ancestorMap.size > 0
    if (!hasRules && !hasOntology) return trials
    let enrichedCount = 0
    const result = trials.map((t) => {
      // Skip client-side enrichment for pinned trials
      if (t.data.ta_pinned) return t
      const enrichedTAs = enrichTherapeuticAreas(
        t.data.therapeutic_areas,
        t.data.conditions,
        rules || [],
        t.data.nct_id,
        ancestorMap,
      )
      if (enrichedTAs.length === (t.data.therapeutic_areas?.length ?? 0) &&
          enrichedTAs.every((ta, i) => ta === t.data.therapeutic_areas?.[i])) {
        return t // unchanged, avoid new object
      }
      enrichedCount++
      return { ...t, data: { ...t.data, therapeutic_areas: enrichedTAs } }
    })
    console.log(`[enrichment] Enriched ${enrichedCount} trials (rules: ${rules?.length ?? 0}, ontology ancestors: ${ancestorMap?.size ?? 0})`)
    return result
  }, [trials, rules, ancestorMap])

  const filtered = useMemo(() => {
    if (!enrichedTrials) return []
    if (filters.country && filters.country.length > 0 && !countryNctIds) return []

    return enrichedTrials.filter((t) => {
      const d = t.data

      // NCT ID filter (programmatic, not shown in UI quick filters)
      if (filters.nct_id?.length && !filters.nct_id.includes(d.nct_id)) return false

      // Multi-select filters: trial must match at least one selected value
      if (filters.status?.length && !filters.status.includes(d.status)) return false
      if (filters.phase?.length && !filters.phase.some((p) => d.phases?.includes(p))) return false
      if (filters.study_type?.length && !filters.study_type.includes(d.study_type)) return false
      if (filters.therapeutic_area?.length && !filters.therapeutic_area.some((ta) => d.therapeutic_areas?.includes(ta))) return false
      if (filters.molecule?.length && !filters.molecule.some((m) => d.interventions?.includes(m))) return false
      if (filters.sponsor?.length && !filters.sponsor.includes(d.sponsor)) return false
      if (filters.country?.length && countryNctIds && !countryNctIds.has(d.nct_id)) return false
      if (filters.condition?.length) {
        const condLower = (d.conditions || []).map((c) => c.toLowerCase())
        if (!filters.condition.some((fc) => condLower.some((c) => c.includes(fc.toLowerCase())))) return false
      }

      // Single-value filters
      if (filters.has_results === 'true' && !d.has_results) return false
      if (filters.bookmarked === 'true' && !isBookmarked(d.nct_id)) return false

      // Data-availability filters
      if (filters.has_ae_data === 'true' && aeNctIds && !aeNctIds.has(d.nct_id)) return false
      if (filters.has_outcomes === 'true' && outcomeNctIds && !outcomeNctIds.has(d.nct_id)) return false
      if (filters.has_baseline === 'true' && baselineNctIds && !baselineNctIds.has(d.nct_id)) return false
      if (filters.has_protocol === 'true' && protocolNctIds && !protocolNctIds.has(d.nct_id)) return false
      if (filters.has_roche_id === 'true' && !d.org_study_id) return false
      if (filters.has_roche_id === 'false' && d.org_study_id) return false
      if (filters.has_samples === 'true' && samplesNctIds && !samplesNctIds.has(d.nct_id)) return false

      // Eligibility filters
      if (filters.has_eligibility === 'true' && eligNctIds && !eligNctIds.has(d.nct_id)) return false
      if (filters.elig_pregnancy_excluded === 'true' && pregnancyExcluded && !pregnancyExcluded.has(d.nct_id)) return false
      if (filters.elig_cns_excluded === 'true' && cnsExcluded && !cnsExcluded.has(d.nct_id)) return false
      if (filters.elig_hiv_excluded === 'true' && hivExcluded && !hivExcluded.has(d.nct_id)) return false
      if (filters.elig_autoimmune_excluded === 'true' && autoExcluded && !autoExcluded.has(d.nct_id)) return false
      if (filters.elig_measurable === 'true' && measurableRequired && !measurableRequired.has(d.nct_id)) return false
      if (filters.elig_healthy_volunteers === 'true' && healthyVol && !healthyVol.has(d.nct_id)) return false
      if (filters.elig_search && eligSearchNctIds && !eligSearchNctIds.has(d.nct_id)) return false
      if (filters.fts_search && globalSearchResult && !globalSearchResult.nctIds.has(d.nct_id)) return false

      // Free-text search
      if (filters.search) {
        const q = filters.search.toLowerCase()
        const searchable = [d.nct_id, d.title, d.brief_title, d.acronym, ...(d.conditions || []), ...(d.interventions || [])].filter(Boolean).join(' ').toLowerCase()
        if (!searchable.includes(q)) return false
      }

      return true
    })
  }, [enrichedTrials, filters, isBookmarked, countryNctIds, aeNctIds, outcomeNctIds, baselineNctIds, protocolNctIds, samplesNctIds, eligNctIds, pregnancyExcluded, cnsExcluded, hivExcluded, autoExcluded, measurableRequired, healthyVol, eligSearchNctIds, globalSearchResult])

  return { trials: filtered, allTrials: enrichedTrials, isLoading, error, refetch, globalSearchMatches: globalSearchResult?.matches }
}
