import { useQuery } from '@tanstack/react-query'

interface TATerm {
  value: string
  label: string
  aliases: string[]
}

/** Fetch CT_THERAPEUTIC_AREA terms with aliases from WIP API */
export function useTherapeuticAreaTerms() {
  return useQuery<TATerm[]>({
    queryKey: ['clintrial', 'ta-terms'],
    queryFn: async () => {
      // Resolve terminology ID by value
      const lookupRes = await fetch(
        '/api/def-store/terminologies/by-value/CT_THERAPEUTIC_AREA?namespace=clintrial',
        { headers: { 'X-API-Key': import.meta.env.VITE_WIP_API_KEY } },
      )
      if (!lookupRes.ok) return []
      const terminology = await lookupRes.json()
      const terminologyId = terminology.terminology_id
      if (!terminologyId) return []

      const res = await fetch(
        `/api/def-store/terminologies/${terminologyId}/terms?page_size=100`,
        { headers: { 'X-API-Key': import.meta.env.VITE_WIP_API_KEY } },
      )
      if (!res.ok) return []
      const data = await res.json()
      return (data.items ?? []).map((t: Record<string, unknown>) => ({
        value: t.value as string,
        label: (t.label as string) || (t.value as string),
        aliases: (t.aliases as string[]) || [],
      }))
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
