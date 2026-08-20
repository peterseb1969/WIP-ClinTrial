import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'

export interface GlobalSearchResult {
  nctIds: Set<string>
  matches: Map<string, { sources: Set<string>; snippet?: string }>
}

const EMPTY_RESULT: GlobalSearchResult = {
  nctIds: new Set(),
  matches: new Map(),
}

/**
 * Full-text search across trial descriptions, outcomes, AEs, baselines, sites, and eligibility.
 * Returns a set of NCT IDs that match the query along with which data source matched.
 */
export function useGlobalSearch(query: string | undefined) {
  return useQuery({
    queryKey: ['clintrial', 'global-fts', query],
    queryFn: async (): Promise<GlobalSearchResult> => {
      if (!query) return EMPTY_RESULT

      const results = await reportQuery<{
        nct_id: string
        source: string
        snippet: string | null
      }>(
        `-- Trial text (title, summary, description, eligibility)
         SELECT nct_id, 'description' as source,
                ts_headline('english', COALESCE(brief_summary, ''), plainto_tsquery('english', $1),
                            'MaxWords=25,MinWords=10,StartSel=**,StopSel=**') as snippet
         FROM clintrial.doc_ct_trial__v2
         WHERE title_tsv @@ plainto_tsquery('english', $1)
            OR brief_title_tsv @@ plainto_tsquery('english', $1)
            OR brief_summary_tsv @@ plainto_tsquery('english', $1)
            OR detailed_description_tsv @@ plainto_tsquery('english', $1)
            OR eligibility_criteria_tsv @@ plainto_tsquery('english', $1)

         UNION ALL

         -- Outcome measures
         SELECT DISTINCT nct_id, 'outcome' as source,
                ts_headline('english', COALESCE(measure, ''), plainto_tsquery('english', $1),
                            'MaxWords=25,StartSel=**,StopSel=**') as snippet
         FROM clintrial.doc_ct_trial_outcome__v2
         WHERE measure_tsv @@ plainto_tsquery('english', $1)
            OR description_tsv @@ plainto_tsquery('english', $1)

         UNION ALL

         -- Adverse events
         SELECT DISTINCT nct_id, 'ae' as source, term as snippet
         FROM clintrial.doc_ct_trial_ae__v2
         WHERE term_tsv @@ plainto_tsquery('english', $1)

         UNION ALL

         -- Baseline measures
         SELECT DISTINCT nct_id, 'baseline' as source, measure_title as snippet
         FROM clintrial.doc_ct_trial_baseline__v2
         WHERE measure_title_tsv @@ plainto_tsquery('english', $1)

         UNION ALL

         -- Sites (facility names)
         SELECT DISTINCT nct_id, 'site' as source, facility as snippet
         FROM clintrial.doc_ct_trial_site__v2
         WHERE facility_tsv @@ plainto_tsquery('english', $1)

         UNION ALL

         -- Eligibility criteria (already on v1)
         SELECT DISTINCT nct_id, 'eligibility' as source, NULL as snippet
         FROM clintrial.doc_ct_trial_eligibility__v1
         WHERE criteria_json_tsv @@ plainto_tsquery('english', $1)`,
        [query],
        10000,
      )

      const matches = new Map<string, { sources: Set<string>; snippet?: string }>()

      for (const row of results.rows) {
        const existing = matches.get(row.nct_id)
        if (existing) {
          existing.sources.add(row.source)
        } else {
          matches.set(row.nct_id, {
            sources: new Set([row.source]),
            snippet: row.snippet || undefined,
          })
        }
      }

      return {
        nctIds: new Set(matches.keys()),
        matches,
      }
    },
    enabled: !!query && query.length >= 2,
    staleTime: 5 * 60 * 1000,
  })
}
