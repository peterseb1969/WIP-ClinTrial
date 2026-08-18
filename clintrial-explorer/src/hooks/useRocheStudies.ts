import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'

export interface RocheStudyRow {
  document_id: string
  study_number: string
  study_name?: string
  study_short_title?: string
  study_phase?: string
  study_status?: string
  study_stage?: string
  study_type?: string
  therapeutic_area?: string
  disease_area?: string
  indication?: string
  theme_molecule?: string
  non_lead_molecule?: string
  sponsor_type?: string
  actual_enrolled?: string
  [key: string]: unknown
}

export function useRocheStudies() {
  return useQuery({
    queryKey: ['roche-studies'],
    queryFn: async () => {
      const result = await reportQuery<Record<string, unknown>>(
        `SELECT document_id, study_number, study_name, study_short_title,
                study_phase, study_status, study_stage, study_type,
                therapeutic_area, disease_area, indication,
                theme_molecule, non_lead_molecule, sponsor_type,
                actual_enrolled
         FROM doc_ct_ta_study`,
        [],
        10000,
      )

      return result.rows.map((r) => ({
        ...r,
        study_number: String(r.study_number),
        document_id: String(r.document_id),
      })) as RocheStudyRow[]
    },
    staleTime: 60000,
  })
}

export function useRocheStudyDetail(documentId: string | null) {
  return useQuery({
    queryKey: ['roche-study-detail', documentId],
    enabled: !!documentId,
    queryFn: async () => {
      const result = await reportQuery<Record<string, unknown>>(
        `SELECT * FROM doc_ct_ta_study WHERE document_id = $1 LIMIT 1`,
        [documentId],
      )
      return result.rows[0] || null
    },
  })
}
