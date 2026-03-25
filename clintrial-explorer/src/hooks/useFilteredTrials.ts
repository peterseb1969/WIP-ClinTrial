import { useMemo } from 'react'
import { useAllTrials, useTrialsByCountry } from './useAllTrials'
import { useTrialFilters } from './useTrialFilters'
import { useBookmarks } from './useBookmarks'

/** Returns all trials filtered by the current global filter state. */
export function useFilteredTrials() {
  const { data: trials, isLoading, error, refetch } = useAllTrials()
  const { filters } = useTrialFilters()
  const { has: isBookmarked } = useBookmarks()
  const { data: countryNctIds } = useTrialsByCountry(filters.country)

  const filtered = useMemo(() => {
    if (!trials) return []
    if (filters.country && !countryNctIds) return []

    return trials.filter((t) => {
      const d = t.data
      if (filters.status && d.status !== filters.status) return false
      if (filters.phase && !d.phases?.includes(filters.phase)) return false
      if (filters.study_type && d.study_type !== filters.study_type) return false
      if (filters.therapeutic_area && !d.therapeutic_areas?.includes(filters.therapeutic_area)) return false
      if (filters.molecule && !d.interventions?.includes(filters.molecule)) return false
      if (filters.sponsor && d.sponsor !== filters.sponsor) return false
      if (filters.has_results === 'true' && !d.has_results) return false
      if (filters.has_results === 'false' && d.has_results) return false
      if (filters.bookmarked === 'true' && !isBookmarked(d.nct_id)) return false
      if (filters.country && countryNctIds && !countryNctIds.has(d.nct_id)) return false
      if (filters.condition) {
        const q = filters.condition.toLowerCase()
        if (!d.conditions?.some((c) => c.toLowerCase().includes(q))) return false
      }
      if (filters.search) {
        const q = filters.search.toLowerCase()
        const searchable = [d.nct_id, d.title, d.brief_title, d.acronym, ...(d.conditions || []), ...(d.interventions || [])].filter(Boolean).join(' ').toLowerCase()
        if (!searchable.includes(q)) return false
      }
      return true
    })
  }, [trials, filters, isBookmarked, countryNctIds])

  return { trials: filtered, allTrials: trials, isLoading, error, refetch }
}
