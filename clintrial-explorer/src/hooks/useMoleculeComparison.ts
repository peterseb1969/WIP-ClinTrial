import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'
import { useAllTrials } from './useAllTrials'
import { useMemo } from 'react'

interface AEByMolecule {
  molecule: string
  term: string
  organ_system: string
  trial_count: number
}

/** Fetch AE profiles for multiple molecules in a single query */
export function useMoleculeComparisonAEs(moleculeNames: string[]) {
  const { data: allTrials } = useAllTrials()

  // Get NCT IDs for all selected molecules
  const nctIds = useMemo(() => {
    if (!allTrials) return []
    const ids = new Set<string>()
    for (const t of allTrials) {
      if (moleculeNames.some((m) => t.data.interventions?.includes(m))) {
        ids.add(t.data.nct_id)
      }
    }
    return [...ids]
  }, [allTrials, moleculeNames])

  const { data, isLoading } = useQuery({
    queryKey: ['clintrial', 'molecule-compare-aes', moleculeNames.sort().join(',')],
    queryFn: async () => {
      if (nctIds.length === 0) return []
      const result = await reportQuery<AEByMolecule>(
        `SELECT i.value as molecule, ae.term, ae.organ_system,
                COUNT(DISTINCT ae.nct_id) as trial_count
         FROM doc_ct_trial_ae ae
         JOIN doc_ct_trial t ON ae.nct_id = t.nct_id AND t.status = 'active',
              jsonb_array_elements_text(t.interventions::jsonb) as i(value)
         WHERE ae.status = 'active'
           AND ae.nct_id = ANY($1)
           AND i.value = ANY($2)
         GROUP BY i.value, ae.term, ae.organ_system
         ORDER BY i.value, trial_count DESC`,
        [nctIds, moleculeNames],
        5000,
      )
      return result.rows.map((r) => ({
        ...r,
        trial_count: Number(r.trial_count),
      }))
    },
    enabled: nctIds.length > 0 && moleculeNames.length >= 2,
    staleTime: 5 * 60 * 1000,
  })

  return { data: data ?? [], isLoading }
}
