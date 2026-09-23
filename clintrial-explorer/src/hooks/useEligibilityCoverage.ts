import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'

export interface EligibilityCoverage {
  totalWithText: number
  extracted: number
  pending: number
  withHash: number
  stale: number
  current: number
}

export function useEligibilityCoverage() {
  return useQuery({
    queryKey: ['clintrial', 'eligibility-coverage'],
    queryFn: async () => {
      const [basic, staleness] = await Promise.all([
        reportQuery<{
          total_with_text: number
          extracted: number
          pending: number
        }>(
          `SELECT
             (SELECT COUNT(DISTINCT nct_id) FROM doc_ct_trial
              WHERE eligibility_criteria IS NOT NULL AND eligibility_criteria != '') AS total_with_text,
             (SELECT COUNT(DISTINCT nct_id) FROM doc_ct_trial_eligibility) AS extracted,
             (SELECT COUNT(DISTINCT t.nct_id) FROM doc_ct_trial t
              WHERE t.eligibility_criteria IS NOT NULL AND t.eligibility_criteria != ''
                AND t.nct_id NOT IN (SELECT nct_id FROM doc_ct_trial_eligibility)) AS pending`,
        ),
        reportQuery<{
          with_hash: number
          stale: number
          current: number
        }>(
          `SELECT
             (SELECT COUNT(*) FROM doc_ct_trial_eligibility__v3 WHERE source_hash IS NOT NULL) AS with_hash,
             (SELECT COUNT(*) FROM doc_ct_trial_eligibility__v3 e
              JOIN doc_ct_trial t ON t.nct_id = e.nct_id
              WHERE e.source_hash IS NOT NULL
                AND e.source_hash != md5(t.eligibility_criteria)) AS stale,
             (SELECT COUNT(*) FROM doc_ct_trial_eligibility__v3 e
              JOIN doc_ct_trial t ON t.nct_id = e.nct_id
              WHERE e.source_hash IS NOT NULL
                AND e.source_hash = md5(t.eligibility_criteria)) AS current`,
        ),
      ])
      const b = basic.rows[0]
      const s = staleness.rows[0]
      return {
        totalWithText: b.total_with_text,
        extracted: b.extracted,
        pending: b.pending,
        withHash: s.with_hash,
        stale: s.stale,
        current: s.current,
      } as EligibilityCoverage
    },
    staleTime: 10 * 60 * 1000,
  })
}
