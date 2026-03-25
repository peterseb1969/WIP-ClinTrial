import { useQuery } from '@tanstack/react-query'
import { useWipClient } from '@wip/react'
import type { Document } from '@wip/client'
import type { TrialData } from './useAllTrials'
import { reportQuery } from '@/lib/reporting'

interface TrialDetailResult {
  document_id: string
  data: TrialData
}

/** Fetch a single trial by NCT ID via reporting SQL */
export function useTrial(nctId: string) {
  return useQuery<TrialDetailResult | null>({
    queryKey: ['clintrial', 'trial', nctId],
    queryFn: async () => {
      const result = await reportQuery<{ document_id: string; data_json: string }>(
        `SELECT document_id, data_json FROM doc_ct_trial WHERE nct_id = $1 LIMIT 1`,
        [nctId],
      )
      if (result.rows.length === 0) return null
      const row = result.rows[0]
      const data = typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json
      return { document_id: row.document_id, data } as TrialDetailResult
    },
    enabled: !!nctId,
    staleTime: 5 * 60 * 1000,
  })
}

/** Shape that mirrors the Document type enough for the UI components */
interface DocLike {
  document_id: string
  data: Record<string, unknown>
}

/** Fetch related documents by nct_id from a reporting table */
function useTrialRelated(table: string, nctId: string, queryKey: string) {
  return useQuery<DocLike[]>({
    queryKey: ['clintrial', queryKey, nctId],
    queryFn: async () => {
      const result = await reportQuery<{ document_id: string; data_json: string }>(
        `SELECT document_id, data_json FROM ${table} WHERE nct_id = $1`,
        [nctId],
        5000,
      )
      return result.rows.map((row) => {
        const data = typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json
        return { document_id: row.document_id, data }
      })
    },
    enabled: !!nctId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useTrialOutcomes(nctId: string) {
  return useTrialRelated('doc_ct_trial_outcome', nctId, 'outcomes')
}

export function useTrialSites(nctId: string) {
  return useTrialRelated('doc_ct_trial_site', nctId, 'sites')
}

export function useTrialAEs(nctId: string) {
  return useTrialRelated('doc_ct_trial_ae', nctId, 'aes')
}

export function useTrialBaselines(nctId: string) {
  return useTrialRelated('doc_ct_trial_baseline', nctId, 'baselines')
}

/** Fetch files linked to a trial document */
export function useTrialFiles(trialDocId: string) {
  const client = useWipClient()

  return useQuery({
    queryKey: ['clintrial', 'files', trialDocId],
    queryFn: async () => {
      const doc = await client.documents.getDocument(trialDocId)
      const fileRefs = (doc as Document & { file_references?: Array<{ file_id: string }> }).file_references || []
      if (fileRefs.length === 0) return []

      const files = await Promise.all(
        fileRefs.map(async (ref) => {
          try {
            return await client.files.getFile(ref.file_id)
          } catch {
            return null
          }
        }),
      )
      return files.filter(Boolean)
    },
    enabled: !!trialDocId,
    staleTime: 10 * 60 * 1000,
  })
}
