import { useQuery } from '@tanstack/react-query'
import { useWipClient } from '@wip/react'
import type { Document } from '@wip/client'

export interface TrialData {
  nct_id: string
  title: string
  brief_title: string
  acronym?: string
  status: string
  phases: string[]
  study_type: string
  therapeutic_areas?: string[]
  brief_summary?: string
  enrollment?: number
  start_date?: string
  primary_completion_date?: string
  completion_date?: string
  sponsor: string
  collaborators?: string[]
  interventions?: string[]
  conditions?: string[]
  eligibility_criteria?: string
  minimum_age?: string
  maximum_age?: string
  sex?: string
  healthy_volunteers?: string
  has_results: boolean
  ctgov_url?: string
}

export interface TrialDocument extends Document {
  data: TrialData & Record<string, unknown>
}

/** Fetch all CT_TRIAL documents (paginated internally). Returns full array. */
export function useAllTrials() {
  const client = useWipClient()

  return useQuery<TrialDocument[]>({
    queryKey: ['clintrial', 'all-trials'],
    queryFn: async () => {
      const allDocs: TrialDocument[] = []
      let page = 1
      const pageSize = 100

      while (true) {
        const result = await client.documents.listDocuments({
          template_value: 'CT_TRIAL',
          status: 'active',
          page,
          page_size: pageSize,
        })
        allDocs.push(...(result.items as TrialDocument[]))
        if (page >= result.pages) break
        page++
      }

      return allDocs
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — trial data doesn't change often
  })
}
