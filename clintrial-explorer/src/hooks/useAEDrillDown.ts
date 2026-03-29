import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'
import { type SqlQuery } from '@/components/SqlInspector'

export interface AEDrillDownRow {
  nct_id: string
  brief_title: string
  group_title: string
  num_affected: number
  num_at_risk: number
  incidence_pct: number
}

const DRILL_DOWN_SQL = `SELECT ae.nct_id, t.brief_title,
       s.val->>'group_title' as group_title,
       (s.val->>'num_affected')::int as num_affected,
       (s.val->>'num_at_risk')::int as num_at_risk
FROM doc_ct_trial_ae ae
JOIN doc_ct_trial t ON ae.nct_id = t.nct_id AND t.status = 'active',
     jsonb_array_elements(ae.stats::jsonb) as s(val)
WHERE ae.status = 'active'
  AND ae.term = $1
  AND ae.ae_category = $2
  AND ae.nct_id = ANY($3)
ORDER BY (s.val->>'num_affected')::int DESC`

/** Lazy-loaded drill-down for a specific AE term: per-trial, per-arm stats */
export function useAEDrillDown(term: string, aeCategory: string, nctIds: string[], enabled: boolean) {
  const { data, isLoading } = useQuery({
    queryKey: ['clintrial', 'ae-drilldown', term, aeCategory, nctIds.length],
    queryFn: async () => {
      const result = await reportQuery<Omit<AEDrillDownRow, 'incidence_pct'>>(
        DRILL_DOWN_SQL, [term, aeCategory, nctIds], 5000,
      )
      return result.rows.map((r) => ({
        ...r,
        num_affected: Number(r.num_affected),
        num_at_risk: Number(r.num_at_risk),
        incidence_pct: Number(r.num_at_risk) > 0
          ? (Number(r.num_affected) / Number(r.num_at_risk)) * 100
          : 0,
      }))
    },
    enabled: enabled && nctIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const queries: SqlQuery[] = [{ label: `AE Drill-Down: ${term}`, sql: DRILL_DOWN_SQL, params: [term, aeCategory, nctIds] }]

  return { data: data ?? [], isLoading, queries }
}
