import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'
import { type SqlQuery } from '@/components/SqlInspector'

export interface TrialData {
  nct_id: string
  title: string
  brief_title: string
  acronym?: string
  status: string
  phases: string[]
  study_type: string
  therapeutic_areas?: string[]
  ta_pinned?: boolean
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

export interface TrialDocument {
  document_id: string
  data: TrialData & Record<string, unknown>
}

interface TrialRow {
  document_id: string
  nct_id: string
  title: string
  brief_title: string
  acronym: string | null
  status: string
  phases: string | null
  study_type: string
  therapeutic_areas: string | null
  ta_pinned: boolean | null
  enrollment: number | null
  start_date: string | null
  sponsor: string
  interventions: string | null
  conditions: string | null
  has_results: boolean | null
  ctgov_url: string | null
}

function parseJsonArray(val: string | null): string[] {
  if (!val) return []
  try {
    return JSON.parse(val)
  } catch {
    return []
  }
}

const ALL_TRIALS_SQL = `SELECT t.document_id, t.nct_id, t.title, t.brief_title, t.acronym,
                t.data_status as status, t.phases, t.study_type, t.therapeutic_areas,
                t.ta_pinned, t.enrollment, t.start_date, o.org_name as sponsor, t.interventions,
                t.conditions, t.has_results, t.ctgov_url
         FROM doc_ct_trial t
         LEFT JOIN doc_ct_organization o ON t.sponsor = o.document_id
         WHERE t.status = 'active'`

export const allTrialsQueries: SqlQuery[] = [{ label: 'All Trials', sql: ALL_TRIALS_SQL, params: [] }]

/** Fetch all CT_TRIAL documents via server-side SQL (direct columns, no data_json blob) */
export function useAllTrials() {
  return useQuery<TrialDocument[]>({
    queryKey: ['clintrial', 'all-trials'],
    queryFn: async () => {
      const result = await reportQuery<TrialRow>(ALL_TRIALS_SQL, [], 10000)
      return result.rows.map((r) => ({
        document_id: r.document_id,
        data: {
          nct_id: r.nct_id,
          title: r.title || '',
          brief_title: r.brief_title || '',
          acronym: r.acronym || undefined,
          status: r.status || 'UNKNOWN',
          phases: parseJsonArray(r.phases),
          study_type: r.study_type || '',
          therapeutic_areas: parseJsonArray(r.therapeutic_areas),
          ta_pinned: r.ta_pinned ?? false,
          enrollment: r.enrollment ?? undefined,
          start_date: r.start_date || undefined,
          sponsor: r.sponsor || '',
          interventions: parseJsonArray(r.interventions),
          conditions: parseJsonArray(r.conditions),
          has_results: r.has_results ?? false,
          ctgov_url: r.ctgov_url || undefined,
        } as TrialData & Record<string, unknown>,
      }))
    },
    staleTime: 5 * 60 * 1000,
  })
}

/** Fetch the set of NCT IDs that have sites in any of the given countries */
export function useTrialsByCountries(countries: string[] | undefined) {
  const key = countries ? [...countries].sort().join(',') : ''
  return useQuery<Set<string>>({
    queryKey: ['clintrial', 'trials-by-countries', key],
    queryFn: async () => {
      if (!countries || countries.length === 0) return new Set<string>()
      // Build parameterized IN clause: WHERE country IN ($1, $2, ...)
      const placeholders = countries.map((_, i) => `$${i + 1}`).join(', ')
      const result = await reportQuery<{ nct_id: string }>(
        `SELECT DISTINCT nct_id FROM doc_ct_trial_site WHERE country IN (${placeholders})`,
        countries,
      )
      return new Set(result.rows.map((r) => r.nct_id))
    },
    enabled: !!countries && countries.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}
