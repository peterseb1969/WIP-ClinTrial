import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'
import { useFilteredTrials } from './useFilteredTrials'

export interface SamiRow {
  nct_id: string
  org_study_id: string
  brief_title: string
  sample_type: string
  clinical_event: string
  available: number
  marked_for_disposal: number
  in_circulation: number
  disposed: number
  total_count: number
  unique_participants: number
  earliest_collection: string | null
  latest_collection: string | null
  snapshot_date: string
}

export interface StudySamples {
  nct_id: string
  org_study_id: string
  brief_title: string
  total_available: number
  total_count: number
  plasma: number
  serum: number
  blood: number
  dna: number
  csf: number
  tissue: number
  other: number
  rows: SamiRow[]
}

const TISSUE_TYPES = new Set([
  'Unstained fixed slide', 'Stained fixed slide', 'H and E fixed slide', 'Fixed Block',
])

function bucketType(type: string): keyof Pick<StudySamples, 'plasma' | 'serum' | 'blood' | 'dna' | 'csf' | 'tissue' | 'other'> {
  if (type === 'Plasma') return 'plasma'
  if (type === 'Serum') return 'serum'
  if (type === 'Blood') return 'blood'
  if (type === 'DNA') return 'dna'
  if (type === 'CSF') return 'csf'
  if (TISSUE_TYPES.has(type)) return 'tissue'
  return 'other'
}

function useAllSamiRows() {
  return useQuery({
    queryKey: ['clintrial', 'sami-inventory'],
    queryFn: async () => {
      const result = await reportQuery<SamiRow>(
        `SELECT t.nct_id, t.org_study_id, t.brief_title,
                s.sample_type, s.clinical_event, s.available, s.marked_for_disposal,
                s.in_circulation, s.disposed, s.total_count,
                s.unique_participants,
                s.earliest_collection, s.latest_collection, s.snapshot_date
         FROM doc_ct_sami_study_detail s
         JOIN doc_ct_trial t ON t.org_study_id = s.study_number
         WHERE s.source_system = 'SAMI'
         ORDER BY s.available DESC`,
        [],
        100000,
      )
      return result.rows
    },
    staleTime: 10 * 60 * 1000,
  })
}

export function useSampleInventory() {
  const { data: allRows, isLoading, error } = useAllSamiRows()
  const { trials: filteredTrials, isLoading: trialsLoading } = useFilteredTrials()

  const studies = useMemo(() => {
    if (!allRows || trialsLoading) return []

    const filteredNctIds = new Set(filteredTrials.map((t) => t.data.nct_id))

    const grouped = new Map<string, StudySamples>()
    for (const row of allRows) {
      if (!filteredNctIds.has(row.nct_id)) continue

      let study = grouped.get(row.nct_id)
      if (!study) {
        study = {
          nct_id: row.nct_id,
          org_study_id: row.org_study_id,
          brief_title: row.brief_title,
          total_available: 0,
          total_count: 0,
          plasma: 0, serum: 0, blood: 0, dna: 0, csf: 0, tissue: 0, other: 0,
          rows: [],
        }
        grouped.set(row.nct_id, study)
      }
      study.total_available += row.available || 0
      study.total_count += row.total_count || 0
      study[bucketType(row.sample_type)] += row.available || 0
      study.rows.push(row)
    }

    return [...grouped.values()].sort((a, b) => b.total_available - a.total_available)
  }, [allRows, filteredTrials, trialsLoading])

  const stats = useMemo(() => {
    if (!studies.length) return null
    const totalTrials = filteredTrials?.length ?? 0
    return {
      trialsWithSamples: studies.length,
      totalAvailable: studies.reduce((s, st) => s + st.total_available, 0),
      totalStudies: new Set(studies.map((s) => s.org_study_id)).size,
      coverage: totalTrials > 0 ? Math.round(100 * studies.length / totalTrials) : 0,
    }
  }, [studies, filteredTrials])

  return { studies, stats, isLoading, error }
}
