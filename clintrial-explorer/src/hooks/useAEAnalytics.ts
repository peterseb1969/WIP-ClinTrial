import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'
import { useFilteredTrials } from './useFilteredTrials'
import { useMemo } from 'react'
import { type SqlQuery } from '@/components/SqlInspector'

export interface AERow {
  term: string
  organ_system: string
  ae_category: string
  trial_count: number
  report_count: number
  total_affected: number
  total_at_risk: number
  incidence_pct: number
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

  const categoryClause = category === 'ALL' ? '' : `AND ae.ae_category = '${category}'`
  const sql = `SELECT ae.term, ae.organ_system, ae.ae_category,
                COUNT(DISTINCT ae.nct_id) as trial_count,
                COUNT(*) as report_count,
                SUM((s.val->>'num_affected')::int) as total_affected,
                SUM((s.val->>'num_at_risk')::int) as total_at_risk
         FROM doc_ct_trial_ae ae,
              jsonb_array_elements(ae.stats::jsonb) as s(val)
         WHERE ae.status = 'active'
           AND ae.nct_id = ANY($1)
           ${categoryClause}
         GROUP BY ae.term, ae.organ_system, ae.ae_category
         ORDER BY trial_count DESC
         LIMIT 500`

  const { data, isLoading: loadingQuery } = useQuery({
    queryKey: ['clintrial', 'ae-frequency', nctIds.sort().join(','), category],
    queryFn: async () => {
      if (nctIds.length === 0) return []
      const result = await reportQuery<AERow>(sql, [nctIds])
      return result.rows.map((r) => {
        const affected = Number(r.total_affected) || 0
        const atRisk = Number(r.total_at_risk) || 0
        return {
          ...r,
          trial_count: Number(r.trial_count),
          report_count: Number(r.report_count),
          total_affected: affected,
          total_at_risk: atRisk,
          incidence_pct: atRisk > 0 ? (affected / atRisk) * 100 : 0,
        }
      })
    },
    enabled: nctIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const queries: SqlQuery[] = [{ label: `AE Frequency (${category})`, sql, params: [nctIds] }]

  return {
    data: data ?? [],
    isLoading: loadingTrials || loadingQuery,
    trialCount,
    nctIds,
    queries,
  }
}

/** AE frequency grouped by molecule or therapeutic area */
export function useAEGrouped(groupBy: GroupBy, category: 'ALL' | 'SERIOUS' | 'OTHER') {
  const { nctIds, isLoading: loadingTrials, trialCount } = useFilteredNctIds()

  const categoryClause = category === 'ALL' ? '' : `AND ae.ae_category = '${category}'`
  const jsonbField = groupBy === 'molecule' ? 'interventions' : 'therapeutic_areas'
  const sql = `SELECT entity.value as entity, ae.term, ae.organ_system,
                COUNT(DISTINCT ae.nct_id) as trial_count,
                COUNT(*) as report_count
         FROM doc_ct_trial_ae ae
         JOIN doc_ct_trial t ON ae.nct_id = t.nct_id AND t.status = 'active',
              jsonb_array_elements_text(t.${jsonbField}::jsonb) as entity(value)
         WHERE ae.status = 'active'
           AND ae.nct_id = ANY($1)
           ${categoryClause}
         GROUP BY entity.value, ae.term, ae.organ_system
         ORDER BY entity.value, trial_count DESC`

  const { data, isLoading: loadingQuery } = useQuery({
    queryKey: ['clintrial', 'ae-grouped', groupBy, nctIds.sort().join(','), category],
    queryFn: async () => {
      if (nctIds.length === 0 || groupBy === 'none') return []
      const result = await reportQuery<AEByEntityRow>(sql, [nctIds], 5000)
      return result.rows.map((r) => ({
        ...r,
        trial_count: Number(r.trial_count),
        report_count: Number(r.report_count),
      }))
    },
    enabled: nctIds.length > 0 && groupBy !== 'none',
    staleTime: 5 * 60 * 1000,
  })

  const queries: SqlQuery[] = groupBy !== 'none'
    ? [{ label: `AE by ${groupBy} (${category})`, sql, params: [nctIds] }]
    : []

  return {
    data: data ?? [],
    isLoading: loadingTrials || loadingQuery,
    trialCount,
    queries,
  }
}

/** AE data grouped by the full combination (regimen) of interventions per trial */
export interface AEByCombinationRow {
  combo_key: string
  term: string
  organ_system: string
  trial_count: number
  report_count: number
}

export function useAEByCombination(category: 'ALL' | 'SERIOUS' | 'OTHER') {
  const { nctIds, isLoading: loadingTrials } = useFilteredNctIds()

  const categoryClause = category === 'ALL' ? '' : `AND ae.ae_category = '${category}'`
  const sql = `SELECT t.interventions::text as combo_key, ae.term, ae.organ_system,
                COUNT(DISTINCT ae.nct_id) as trial_count,
                COUNT(*) as report_count
         FROM doc_ct_trial_ae ae
         JOIN doc_ct_trial t ON ae.nct_id = t.nct_id AND t.status = 'active'
         WHERE ae.status = 'active'
           AND ae.nct_id = ANY($1)
           ${categoryClause}
         GROUP BY t.interventions::text, ae.term, ae.organ_system
         ORDER BY trial_count DESC`

  const { data, isLoading: loadingQuery } = useQuery({
    queryKey: ['clintrial', 'ae-by-combination', nctIds.sort().join(','), category],
    queryFn: async () => {
      if (nctIds.length === 0) return []
      const result = await reportQuery<AEByCombinationRow>(sql, [nctIds], 10000)
      return result.rows.map((r) => ({
        ...r,
        trial_count: Number(r.trial_count),
        report_count: Number(r.report_count),
      }))
    },
    enabled: nctIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const queries: SqlQuery[] = [{ label: `AE by Combination (${category})`, sql, params: [nctIds] }]

  return { data: data ?? [], isLoading: loadingTrials || loadingQuery, queries }
}

/** Unique organ systems from the current AE data */
export function useOrganSystems() {
  const { nctIds } = useFilteredNctIds()

  const sql = `SELECT organ_system, COUNT(*) as cnt
         FROM doc_ct_trial_ae
         WHERE status = 'active' AND nct_id = ANY($1)
         GROUP BY organ_system
         ORDER BY cnt DESC`

  const { data } = useQuery({
    queryKey: ['clintrial', 'ae-organ-systems', nctIds.sort().join(',')],
    queryFn: async () => {
      if (nctIds.length === 0) return []
      const result = await reportQuery<{ organ_system: string; cnt: number }>(sql, [nctIds])
      return result.rows.map((r) => r.organ_system).filter(Boolean)
    },
    enabled: nctIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const queries: SqlQuery[] = [{ label: 'Organ Systems', sql, params: [nctIds] }]

  return { data: data ?? [], queries }
}

/** Severity distribution: SERIOUS vs OTHER counts per term (top 30) */
export interface AESeverityRow {
  term: string
  serious_count: number
  other_count: number
  total_count: number
  severity_ratio: number
}

export function useAESeverityDistribution() {
  const { nctIds, isLoading: loadingTrials } = useFilteredNctIds()

  const sql = `SELECT ae.term,
                SUM(CASE WHEN ae.ae_category = 'SERIOUS' THEN 1 ELSE 0 END) as serious_count,
                SUM(CASE WHEN ae.ae_category = 'OTHER' THEN 1 ELSE 0 END) as other_count,
                COUNT(*) as total_count
         FROM doc_ct_trial_ae ae
         WHERE ae.status = 'active'
           AND ae.nct_id = ANY($1)
         GROUP BY ae.term
         HAVING SUM(CASE WHEN ae.ae_category = 'SERIOUS' THEN 1 ELSE 0 END) > 0
            AND SUM(CASE WHEN ae.ae_category = 'OTHER' THEN 1 ELSE 0 END) > 0
         ORDER BY COUNT(*) DESC
         LIMIT 30`

  const { data, isLoading: loadingQuery } = useQuery({
    queryKey: ['clintrial', 'ae-severity', nctIds.sort().join(',')],
    queryFn: async () => {
      if (nctIds.length === 0) return []
      const result = await reportQuery<AESeverityRow>(sql, [nctIds])
      return result.rows.map((r) => {
        const serious = Number(r.serious_count)
        const other = Number(r.other_count)
        const total = Number(r.total_count)
        return {
          ...r,
          serious_count: serious,
          other_count: other,
          total_count: total,
          severity_ratio: total > 0 ? serious / total : 0,
        }
      })
    },
    enabled: nctIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const queries: SqlQuery[] = [{ label: 'AE Severity Distribution', sql, params: [nctIds] }]

  return { data: data ?? [], isLoading: loadingTrials || loadingQuery, queries }
}

/** Temporal AE view: AE counts grouped by trial start year */
export interface AETemporalRow {
  year: string
  term: string
  trial_count: number
}

export function useAETemporal() {
  const { nctIds, isLoading: loadingTrials } = useFilteredNctIds()

  const sql = `SELECT EXTRACT(YEAR FROM t.start_date::date)::text as year,
                ae.term,
                COUNT(DISTINCT ae.nct_id) as trial_count
         FROM doc_ct_trial_ae ae
         JOIN doc_ct_trial t ON ae.nct_id = t.nct_id AND t.status = 'active'
         WHERE ae.status = 'active'
           AND ae.nct_id = ANY($1)
           AND t.start_date IS NOT NULL
         GROUP BY year, ae.term
         ORDER BY year, trial_count DESC`

  const { data, isLoading: loadingQuery } = useQuery({
    queryKey: ['clintrial', 'ae-temporal', nctIds.sort().join(',')],
    queryFn: async () => {
      if (nctIds.length === 0) return []
      const result = await reportQuery<AETemporalRow>(sql, [nctIds], 5000)
      return result.rows.map((r) => ({
        ...r,
        trial_count: Number(r.trial_count),
      }))
    },
    enabled: nctIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const queries: SqlQuery[] = [{ label: 'AE Temporal View', sql, params: [nctIds] }]

  return { data: data ?? [], isLoading: loadingTrials || loadingQuery, queries }
}
