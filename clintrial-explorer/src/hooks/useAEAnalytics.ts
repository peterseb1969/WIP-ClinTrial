import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'
import { useFilteredTrials } from './useFilteredTrials'
import { useMemo } from 'react'

export interface AERow {
  term: string
  organ_system: string
  ae_category: string
  trial_count: number
  report_count: number
}

export interface AEByEntityRow {
  entity: string
  term: string
  organ_system: string
  trial_count: number
  report_count: number
}

type GroupBy = 'none' | 'molecule' | 'therapeutic_area'

/** Get the NCT IDs from the current filtered trial set */
function useFilteredNctIds() {
  const { trials, isLoading } = useFilteredTrials()
  const nctIds = useMemo(() => trials.map((t) => t.data.nct_id), [trials])
  return { nctIds, isLoading, trialCount: trials.length }
}

/** Cross-trial AE frequency, respecting global filters */
export function useAEFrequency(category: 'ALL' | 'SERIOUS' | 'OTHER') {
  const { nctIds, isLoading: loadingTrials, trialCount } = useFilteredNctIds()

  const { data, isLoading: loadingQuery } = useQuery({
    queryKey: ['clintrial', 'ae-frequency', nctIds.sort().join(','), category],
    queryFn: async () => {
      if (nctIds.length === 0) return []
      const categoryClause = category === 'ALL' ? '' : `AND ae.ae_category = '${category}'`
      const result = await reportQuery<AERow>(
        `SELECT ae.term, ae.organ_system, ae.ae_category,
                COUNT(DISTINCT ae.nct_id) as trial_count,
                COUNT(*) as report_count
         FROM doc_ct_trial_ae ae
         WHERE ae.status = 'active'
           AND ae.nct_id = ANY($1)
           ${categoryClause}
         GROUP BY ae.term, ae.organ_system, ae.ae_category
         ORDER BY trial_count DESC
         LIMIT 500`,
        [nctIds],
      )
      return result.rows.map((r) => ({
        ...r,
        trial_count: Number(r.trial_count),
        report_count: Number(r.report_count),
      }))
    },
    enabled: nctIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  return {
    data: data ?? [],
    isLoading: loadingTrials || loadingQuery,
    trialCount,
  }
}

/** AE frequency grouped by molecule or therapeutic area */
export function useAEGrouped(groupBy: GroupBy, category: 'ALL' | 'SERIOUS' | 'OTHER') {
  const { nctIds, isLoading: loadingTrials, trialCount } = useFilteredNctIds()

  const { data, isLoading: loadingQuery } = useQuery({
    queryKey: ['clintrial', 'ae-grouped', groupBy, nctIds.sort().join(','), category],
    queryFn: async () => {
      if (nctIds.length === 0 || groupBy === 'none') return []
      const categoryClause = category === 'ALL' ? '' : `AND ae.ae_category = '${category}'`

      const jsonbField = groupBy === 'molecule' ? 'interventions' : 'therapeutic_areas'
      const result = await reportQuery<AEByEntityRow>(
        `SELECT entity.value as entity, ae.term, ae.organ_system,
                COUNT(DISTINCT ae.nct_id) as trial_count,
                COUNT(*) as report_count
         FROM doc_ct_trial_ae ae
         JOIN doc_ct_trial t ON ae.nct_id = t.nct_id AND t.status = 'active',
              jsonb_array_elements_text(t.${jsonbField}::jsonb) as entity(value)
         WHERE ae.status = 'active'
           AND ae.nct_id = ANY($1)
           ${categoryClause}
         GROUP BY entity.value, ae.term, ae.organ_system
         ORDER BY entity.value, trial_count DESC`,
        [nctIds],
        5000,
      )
      return result.rows.map((r) => ({
        ...r,
        trial_count: Number(r.trial_count),
        report_count: Number(r.report_count),
      }))
    },
    enabled: nctIds.length > 0 && groupBy !== 'none',
    staleTime: 5 * 60 * 1000,
  })

  return {
    data: data ?? [],
    isLoading: loadingTrials || loadingQuery,
    trialCount,
  }
}

/** Unique organ systems from the current AE data */
export function useOrganSystems() {
  const { nctIds } = useFilteredNctIds()

  const { data } = useQuery({
    queryKey: ['clintrial', 'ae-organ-systems', nctIds.sort().join(',')],
    queryFn: async () => {
      if (nctIds.length === 0) return []
      const result = await reportQuery<{ organ_system: string; cnt: number }>(
        `SELECT organ_system, COUNT(*) as cnt
         FROM doc_ct_trial_ae
         WHERE status = 'active' AND nct_id = ANY($1)
         GROUP BY organ_system
         ORDER BY cnt DESC`,
        [nctIds],
      )
      return result.rows.map((r) => r.organ_system).filter(Boolean)
    },
    enabled: nctIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  return data ?? []
}
