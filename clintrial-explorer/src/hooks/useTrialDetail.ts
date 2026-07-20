import { useQuery } from '@tanstack/react-query'
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

/**
 * AEs are the one high-cardinality related table (1000+ rows for large
 * trials), so select the flattened columns instead of parsing the full
 * data_json blob per row (CASE-732; KNOWN_ISSUES #2). Only `stats` needs
 * a JSON parse. Truncation at the 5000 cap is surfaced by the CASE-728
 * warning in reportQuery.
 */
export function useTrialAEs(nctId: string) {
  return useQuery<DocLike[]>({
    queryKey: ['clintrial', 'aes', nctId],
    queryFn: async () => {
      const result = await reportQuery<{
        document_id: string
        ae_category: string | null
        term: string | null
        organ_system: string | null
        source_vocabulary: string | null
        stats: string | unknown[] | null
      }>(
        `SELECT document_id, ae_category, term, organ_system, source_vocabulary, stats
         FROM doc_ct_trial_ae WHERE nct_id = $1`,
        [nctId],
        5000,
      )
      return result.rows.map((row) => ({
        document_id: row.document_id,
        data: {
          ae_category: row.ae_category ?? undefined,
          term: row.term ?? undefined,
          organ_system: row.organ_system ?? undefined,
          source_vocabulary: row.source_vocabulary ?? undefined,
          stats: typeof row.stats === 'string' ? JSON.parse(row.stats) : (row.stats ?? []),
        },
      }))
    },
    enabled: !!nctId,
    staleTime: 5 * 60 * 1000,
  })
}

export function useTrialBaselines(nctId: string) {
  return useTrialRelated('doc_ct_trial_baseline', nctId, 'baselines')
}

interface FileRef {
  file_id: string
  filename: string
  content_type?: string
  size_bytes?: number
  description?: string
}

/** Fetch files linked to a trial by nct_id from the reporting DB */
export function useTrialFiles(nctId: string) {
  return useQuery<FileRef[]>({
    queryKey: ['clintrial', 'files', nctId],
    queryFn: async () => {
      const result = await reportQuery<{ file_references_json: string }>(
        `SELECT file_references_json FROM doc_ct_trial WHERE nct_id = $1`,
        [nctId],
      )
      if (result.rows.length === 0) return []

      const raw = result.rows[0].file_references_json
      if (!raw || raw === '[]') return []

      const refs: FileRef[] = typeof raw === 'string' ? JSON.parse(raw) : raw
      return refs
    },
    enabled: !!nctId,
    staleTime: 10 * 60 * 1000,
  })
}
