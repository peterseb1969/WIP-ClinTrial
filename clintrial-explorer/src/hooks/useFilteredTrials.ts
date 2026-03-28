import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAllTrials, useTrialsByCountries, type TrialDocument } from './useAllTrials'
import { useTrialFilters } from './useTrialFilters'
import { useBookmarks } from './useBookmarks'
import { useClassificationRules, enrichTherapeuticAreas } from './useClassificationRules'
import { reportQuery } from '@/lib/reporting'

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

  return { aeNctIds, outcomeNctIds, baselineNctIds }
}

/** Returns all trials with therapeutic areas enriched by classification rules,
 * then filtered by the current global filter state. */
export function useFilteredTrials() {
  const { data: trials, isLoading, error, refetch } = useAllTrials()
  const { data: rules } = useClassificationRules()
  const { filters } = useTrialFilters()
  const { has: isBookmarked } = useBookmarks()
  const { data: countryNctIds } = useTrialsByCountries(filters.country)
  const { aeNctIds, outcomeNctIds, baselineNctIds } = useDataAvailability()

  // Enrich trials with rule-based TA classification
  const enrichedTrials = useMemo<TrialDocument[] | undefined>(() => {
    if (!trials) return undefined
    if (!rules || rules.length === 0) return trials
    return trials.map((t) => {
      const enrichedTAs = enrichTherapeuticAreas(
        t.data.therapeutic_areas,
        t.data.conditions,
        rules,
        t.data.nct_id,
      )
      if (enrichedTAs.length === (t.data.therapeutic_areas?.length ?? 0) &&
          enrichedTAs.every((ta, i) => ta === t.data.therapeutic_areas?.[i])) {
        return t // unchanged, avoid new object
      }
      return { ...t, data: { ...t.data, therapeutic_areas: enrichedTAs } }
    })
  }, [trials, rules])

  const filtered = useMemo(() => {
    if (!enrichedTrials) return []
    if (filters.country && filters.country.length > 0 && !countryNctIds) return []

    return enrichedTrials.filter((t) => {
      const d = t.data

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

      // Free-text search
      if (filters.search) {
        const q = filters.search.toLowerCase()
        const searchable = [d.nct_id, d.title, d.brief_title, d.acronym, ...(d.conditions || []), ...(d.interventions || [])].filter(Boolean).join(' ').toLowerCase()
        if (!searchable.includes(q)) return false
      }

      return true
    })
  }, [enrichedTrials, filters, isBookmarked, countryNctIds, aeNctIds, outcomeNctIds, baselineNctIds])

  return { trials: filtered, allTrials: enrichedTrials, isLoading, error, refetch }
}
