import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'

export interface RocheStudyRow {
  document_id: string
  source: 'ta_portal' | 'mdms'
  study_number: string
  study_name?: string
  scientific_title?: string
  public_title?: string
  acronym?: string
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
  nct_id?: string
  [key: string]: unknown
}

export function useRocheStudies() {
  return useQuery({
    queryKey: ['roche-studies', 'combined'],
    queryFn: async () => {
      const [ta, mdms] = await Promise.all([
        reportQuery<Record<string, unknown>>(
          `SELECT document_id, study_number, study_name, study_short_title,
                  study_phase, study_status, study_stage, study_type,
                  therapeutic_area, disease_area, indication,
                  theme_molecule, non_lead_molecule, sponsor_type,
                  actual_enrolled, nct_id
           FROM doc_ct_ta_study__v3`,
          [],
          10000,
        ),
        reportQuery<Record<string, unknown>>(
          `SELECT document_id, study_number, acronym, scientific_title,
                  public_title, study_phase, study_type,
                  therapeutic_area, indication, sponsor_type
           FROM doc_ct_mdms_study`,
          [],
          10000,
        ),
      ])

      const taRows: RocheStudyRow[] = ta.rows.map((r) => ({
        ...r,
        source: 'ta_portal' as const,
        study_number: String(r.study_number),
        document_id: String(r.document_id),
      }))
      const mdmsRows: RocheStudyRow[] = mdms.rows.map((r) => ({
        ...r,
        source: 'mdms' as const,
        study_number: String(r.study_number),
        document_id: String(r.document_id),
      }))

      return [...taRows, ...mdmsRows]
    },
    staleTime: 60000,
  })
}

export function useRocheStudyDetail(documentId: string | null, source: string | null) {
  return useQuery({
    queryKey: ['roche-study-detail', documentId, source],
    enabled: !!documentId && !!source,
    queryFn: async () => {
      const table = source === 'ta_portal' ? 'doc_ct_ta_study' : 'doc_ct_mdms_study'
      const result = await reportQuery<Record<string, unknown>>(
        `SELECT * FROM ${table} WHERE document_id = $1 LIMIT 1`,
        [documentId],
      )
      return result.rows[0] || null
    },
  })
}
