import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'

interface CountItem {
  name: string
  count: number
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['clintrial', 'dashboard-stats'],
    queryFn: async () => {
      const [
        totalResult,
        withResultsResult,
        recruitingResult,
        statusResult,
        phaseResult,
        conditionResult,
        moleculeResult,
      ] = await Promise.all([
        reportQuery<{ cnt: number }>('SELECT COUNT(*) as cnt FROM doc_ct_trial'),
        reportQuery<{ cnt: number }>(
          "SELECT COUNT(*) as cnt FROM doc_ct_trial WHERE has_results = true",
        ),
        reportQuery<{ cnt: number }>(
          "SELECT COUNT(*) as cnt FROM doc_ct_trial WHERE data_status = 'RECRUITING'",
        ),
        reportQuery<{ status: string; cnt: number }>(
          'SELECT data_status as status, COUNT(*) as cnt FROM doc_ct_trial GROUP BY data_status ORDER BY cnt DESC',
        ),
        reportQuery<{ phase: string; cnt: number }>(
          `SELECT value as phase, COUNT(*) as cnt
           FROM doc_ct_trial, jsonb_array_elements_text(phases::jsonb) as value
           GROUP BY value ORDER BY cnt DESC`,
        ),
        // Top conditions — need to unnest the JSON array
        reportQuery<{ condition: string; cnt: number }>(
          `SELECT value as condition, COUNT(*) as cnt
           FROM doc_ct_trial, jsonb_array_elements_text(conditions::jsonb) as value
           GROUP BY value ORDER BY cnt DESC LIMIT 15`,
        ),
        // Top molecules
        reportQuery<{ molecule: string; cnt: number }>(
          `SELECT value as molecule, COUNT(*) as cnt
           FROM doc_ct_trial, jsonb_array_elements_text(interventions::jsonb) as value
           GROUP BY value ORDER BY cnt DESC LIMIT 15`,
        ),
      ])

      return {
        total: totalResult.rows[0]?.cnt ?? 0,
        withResults: withResultsResult.rows[0]?.cnt ?? 0,
        recruiting: recruitingResult.rows[0]?.cnt ?? 0,
        byStatus: statusResult.rows.map((r) => ({
          name: r.status,
          count: Number(r.cnt),
        })) as CountItem[],
        byPhase: phaseResult.rows.map((r) => ({
          name: r.phase,
          count: Number(r.cnt),
        })) as CountItem[],
        byCondition: conditionResult.rows.map((r) => ({
          name: r.condition,
          count: Number(r.cnt),
        })) as CountItem[],
        byMolecule: moleculeResult.rows.map((r) => ({
          name: r.molecule,
          count: Number(r.cnt),
        })) as CountItem[],
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}
