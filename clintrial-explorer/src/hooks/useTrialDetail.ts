import { useQuery } from '@tanstack/react-query'
import { useWipClient } from '@wip/react'
import type { Document } from '@wip/client'
import type { TrialDocument } from './useAllTrials'

/** Fetch a single trial by NCT ID */
export function useTrial(nctId: string) {
  const client = useWipClient()

  return useQuery<TrialDocument | null>({
    queryKey: ['clintrial', 'trial', nctId],
    queryFn: async () => {
      const result = await client.documents.queryDocuments({
        template_id: undefined,
        filters: [{ field: 'data.nct_id', operator: 'eq', value: nctId }],
        page_size: 1,
      })
      return (result.items[0] as TrialDocument) ?? null
    },
    enabled: !!nctId,
    staleTime: 5 * 60 * 1000,
  })
}

/** Fetch outcomes for a trial */
export function useTrialOutcomes(nctId: string) {
  const client = useWipClient()

  return useQuery<Document[]>({
    queryKey: ['clintrial', 'outcomes', nctId],
    queryFn: async () => {
      const all: Document[] = []
      let page = 1
      while (true) {
        const result = await client.documents.queryDocuments({
          filters: [
            { field: 'data.nct_id', operator: 'eq', value: nctId },
            { field: 'template_value', operator: 'eq', value: 'CT_TRIAL_OUTCOME' },
          ],
          page,
          page_size: 100,
        })
        all.push(...result.items)
        if (page >= result.pages) break
        page++
      }
      return all
    },
    enabled: !!nctId,
    staleTime: 5 * 60 * 1000,
  })
}

/** Fetch sites for a trial */
export function useTrialSites(nctId: string) {
  const client = useWipClient()

  return useQuery<Document[]>({
    queryKey: ['clintrial', 'sites', nctId],
    queryFn: async () => {
      const all: Document[] = []
      let page = 1
      while (true) {
        const result = await client.documents.queryDocuments({
          filters: [
            { field: 'data.nct_id', operator: 'eq', value: nctId },
            { field: 'template_value', operator: 'eq', value: 'CT_TRIAL_SITE' },
          ],
          page,
          page_size: 100,
        })
        all.push(...result.items)
        if (page >= result.pages) break
        page++
      }
      return all
    },
    enabled: !!nctId,
    staleTime: 5 * 60 * 1000,
  })
}

/** Fetch adverse events for a trial */
export function useTrialAEs(nctId: string) {
  const client = useWipClient()

  return useQuery<Document[]>({
    queryKey: ['clintrial', 'aes', nctId],
    queryFn: async () => {
      const all: Document[] = []
      let page = 1
      while (true) {
        const result = await client.documents.queryDocuments({
          filters: [
            { field: 'data.nct_id', operator: 'eq', value: nctId },
            { field: 'template_value', operator: 'eq', value: 'CT_TRIAL_AE' },
          ],
          page,
          page_size: 100,
        })
        all.push(...result.items)
        if (page >= result.pages) break
        page++
      }
      return all
    },
    enabled: !!nctId,
    staleTime: 5 * 60 * 1000,
  })
}

/** Fetch baseline characteristics for a trial */
export function useTrialBaselines(nctId: string) {
  const client = useWipClient()

  return useQuery<Document[]>({
    queryKey: ['clintrial', 'baselines', nctId],
    queryFn: async () => {
      const result = await client.documents.queryDocuments({
        filters: [
          { field: 'data.nct_id', operator: 'eq', value: nctId },
          { field: 'template_value', operator: 'eq', value: 'CT_TRIAL_BASELINE' },
        ],
        page_size: 100,
      })
      return result.items
    },
    enabled: !!nctId,
    staleTime: 5 * 60 * 1000,
  })
}

/** Fetch files linked to a trial document */
export function useTrialFiles(trialDocId: string) {
  const client = useWipClient()

  return useQuery({
    queryKey: ['clintrial', 'files', trialDocId],
    queryFn: async () => {
      // Get the trial document to find file references
      const doc = await client.documents.getDocument(trialDocId)
      const fileRefs = (doc as Document & { file_references?: Array<{ file_id: string }> }).file_references || []
      if (fileRefs.length === 0) return []

      // Fetch file metadata for each referenced file
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
