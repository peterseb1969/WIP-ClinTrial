import { useQuery } from '@tanstack/react-query'
import { wipProxyUrl } from '@/lib/config'

export interface TATerm {
  term_id: string
  value: string
  label: string
  aliases: string[]
}

export interface TATermsData {
  terminologyId: string | null
  terms: TATerm[]
}

/** Fetch CT_THERAPEUTIC_AREA terms with aliases from WIP API */
export function useTherapeuticAreaTerms() {
  return useQuery<TATermsData>({
    queryKey: ['clintrial', 'ta-terms'],
    queryFn: async () => {
      // Resolve terminology ID by value
      const lookupRes = await fetch(
        wipProxyUrl('/api/def-store/terminologies/by-value/CT_THERAPEUTIC_AREA?namespace=clintrial'),
      )
      if (!lookupRes.ok) return { terminologyId: null, terms: [] }
      const terminology = await lookupRes.json()
      const terminologyId = terminology.terminology_id
      if (!terminologyId) return { terminologyId: null, terms: [] }

      const res = await fetch(
        wipProxyUrl(`/api/def-store/terminologies/${terminologyId}/terms?page_size=500`),
      )
      if (!res.ok) return { terminologyId, terms: [] }
      const data = await res.json()
      const terms: TATerm[] = (data.items ?? []).map((t: Record<string, unknown>) => ({
        term_id: t.term_id as string,
        value: t.value as string,
        label: (t.label as string) || (t.value as string),
        aliases: (t.aliases as string[]) || [],
      }))
      return { terminologyId, terms }
    },
    staleTime: 30 * 60 * 1000,
  })
}

/** Build a map of TA value → set of lowercase keywords for matching conditions */
export function buildKeywordMap(terms: TATerm[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const term of terms) {
    const keywords = new Set<string>()
    keywords.add(term.value.replace(/_/g, ' ').toLowerCase())
    keywords.add(term.label.toLowerCase())
    for (const alias of term.aliases) {
      keywords.add(alias.toLowerCase())
    }
    map.set(term.value, keywords)
  }
  return map
}

/** Check if a condition string matches any keyword for a therapeutic area */
export function conditionMatchesArea(
  condition: string,
  areaValue: string,
  keywordMap: Map<string, Set<string>>,
): boolean {
  const keywords = keywordMap.get(areaValue)
  if (!keywords) return false
  const condLower = condition.toLowerCase()
  for (const keyword of keywords) {
    if (keyword.length <= 2) continue
    if (keyword.length <= 4) {
      // Word boundary match for short keywords
      if (new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(condLower)) return true
    } else {
      if (condLower.includes(keyword) || keyword.includes(condLower)) return true
    }
  }
  return false
}
