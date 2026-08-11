import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'
import { serverApiUrl } from '@/lib/config'

export interface CurationCandidate {
  document_id: string
  topic: string
  item_key: string
  status: string
  confidence: string
  match_data: string
  reviewed_by: string | null
  reviewed_at: string | null
  notes: string | null
}

export interface CurationStats {
  topic: string
  status: string
  cnt: number
}

export function useMappedStudyNumbers() {
  return useQuery({
    queryKey: ['curation', 'mapped-study-numbers'],
    queryFn: async () => {
      const result = await reportQuery<{ study_number: string }>(
        `SELECT study_number FROM doc_ct_ta_study__v3 WHERE nct_id IS NOT NULL AND nct_id != ''`,
        [],
        10000,
      )
      return new Set(result.rows.map((r) => r.study_number))
    },
    staleTime: 30000,
  })
}

export function useCurationCandidates(
  topic: string,
  statusFilter?: string,
  confidence?: string,
) {
  return useQuery({
    queryKey: ['curation', 'candidates', topic, statusFilter, confidence],
    queryFn: async () => {
      const conditions = [`topic = $1`, `status = 'active'`]
      const params: unknown[] = [topic]
      let idx = 2

      if (statusFilter && statusFilter !== 'all') {
        conditions.push(`data_status = $${idx}`)
        params.push(statusFilter)
        idx++
      }
      if (confidence && confidence !== 'all') {
        conditions.push(`confidence = $${idx}`)
        params.push(confidence)
        idx++
      }

      const where = conditions.join(' AND ')
      const result = await reportQuery<CurationCandidate>(
        `SELECT document_id, topic, item_key, data_status as status, confidence, match_data,
                reviewed_by, reviewed_at, notes
         FROM doc_ct_curation_task
         WHERE ${where}
         ORDER BY
           CASE confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
           item_key`,
        params,
        5000,
      )
      return result.rows
    },
  })
}

export function useCurationStats() {
  return useQuery({
    queryKey: ['curation', 'stats'],
    queryFn: async () => {
      const res = await fetch(serverApiUrl('/curation/stats'))
      if (!res.ok) throw new Error(`Stats failed: ${res.status}`)
      const data = await res.json()
      return data.stats as CurationStats[]
    },
  })
}

export function useLoadCandidates() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { matches: unknown[]; min_confidence?: string }) => {
      const res = await fetch(serverApiUrl('/curation/load-candidates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error(`Load failed: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['curation'] })
    },
  })
}

export function useReviewCandidate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      document_id: string
      decision: 'approved' | 'rejected' | 'skipped'
      notes?: string
    }) => {
      const res = await fetch(serverApiUrl('/curation/review'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error(`Review failed: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['curation'] })
    },
  })
}

export function useBulkReview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { document_ids: string[]; decision: string }) => {
      const res = await fetch(serverApiUrl('/curation/bulk-review'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error(`Bulk review failed: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['curation'] })
    },
  })
}

export function useClearCandidates() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (topic: string) => {
      const res = await fetch(serverApiUrl('/curation/clear'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      })
      if (!res.ok) throw new Error(`Clear failed: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['curation'] })
    },
  })
}

export function useStudyDetail(studyNumber: string | null, expanded = false) {
  return useQuery({
    queryKey: ['curation', 'ta-study', studyNumber, expanded],
    enabled: !!studyNumber,
    queryFn: async () => {
      // Try CT_TA_STUDY first (richer data from TA-Portal)
      const taCols = expanded
        ? `study_number, study_name, study_short_title, study_phase,
           study_status, study_stage, study_type, therapeutic_area, disease_area,
           indication, theme_molecule, non_lead_molecule, sponsor_type,
           actual_enrolled, actual_screened,
           dt_protocol_approval, dt_first_site_activation, dt_first_screening,
           dt_first_enrolled, dt_last_enrolled, dt_last_visit,
           dt_complete_db_lock, dt_clinical_closure`
        : `study_number, study_name, study_phase,
           study_status, study_type, indication, theme_molecule, actual_enrolled`
      const taResult = await reportQuery<Record<string, unknown>>(
        `SELECT ${taCols} FROM doc_ct_ta_study WHERE study_number = $1 LIMIT 1`,
        [studyNumber],
      )
      if (taResult.rows.length > 0) return taResult.rows[0]

      // Fall back to CT_MDMS_STUDY (thinner but covers more studies)
      const mdmsCols = expanded
        ? `study_number, acronym, scientific_title, public_title, study_phase,
           study_type, therapeutic_area, indication, sponsor_type,
           accountable_party, executing_party`
        : `study_number, scientific_title, study_phase,
           study_type, indication, therapeutic_area`
      const mdmsResult = await reportQuery<Record<string, unknown>>(
        `SELECT ${mdmsCols} FROM doc_ct_mdms_study WHERE study_number = $1 LIMIT 1`,
        [studyNumber],
      )
      if (mdmsResult.rows.length > 0) {
        return { ...mdmsResult.rows[0], _source: 'mdms' }
      }

      return null
    },
  })
}

export function useTrialDetail(nctId: string | null, expanded = false) {
  return useQuery({
    queryKey: ['curation', 'ct-trial', nctId, expanded],
    enabled: !!nctId,
    queryFn: async () => {
      const cols = expanded
        ? `nct_id, title, brief_title, status, phases, study_type,
           conditions, enrollment, start_date, completion_date,
           primary_completion_date, sponsor, interventions,
           minimum_age, maximum_age, sex, has_results`
        : `nct_id, title, brief_title, status, phases, study_type,
           conditions, enrollment, start_date`
      const result = await reportQuery<Record<string, unknown>>(
        `SELECT ${cols} FROM doc_ct_trial WHERE nct_id = $1 LIMIT 1`,
        [nctId],
      )
      return result.rows[0] || null
    },
  })
}
