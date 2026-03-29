import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'

const AE_TERM_TERMINOLOGY_VALUE = 'CT_AE_TERM'

/** Resolve the CT_AE_TERM terminology ID dynamically */
function useAETermTerminologyId() {
  return useQuery({
    queryKey: ['clintrial', 'ae-term-terminology-id'],
    queryFn: async () => {
      const resp = await fetch(
        `/api/def-store/terminologies/by-value/${AE_TERM_TERMINOLOGY_VALUE}?namespace=clintrial`,
        { headers: { 'Content-Type': 'application/json' } },
      )
      if (!resp.ok) return null
      const data = await resp.json()
      return data.terminology_id as string
    },
    staleTime: 30 * 60 * 1000,
  })
}

export interface ResolvedTerm {
  canonical: string
  termId: string
  label: string
  aliases: string[]
}

interface TermRow {
  term_id: string
  value: string
  label: string
  aliases: string | null
}

/**
 * Fetches all CT_AE_TERM terms via reporting SQL (fast, no pagination limit)
 * and builds a resolution map. Raw AE strings are matched case-insensitively
 * against term values and aliases.
 */
export function useAETermResolution() {
  const { data: terminologyId } = useAETermTerminologyId()

  // Fetch all terms via SQL — avoids the 100-per-page REST limit
  const { data: terms } = useQuery({
    queryKey: ['clintrial', 'ae-terms-all', terminologyId],
    queryFn: async () => {
      if (!terminologyId) return []
      const result = await reportQuery<TermRow>(
        `SELECT term_id, value, label, aliases
         FROM terms
         WHERE terminology_id = $1 AND status = 'active'`,
        [terminologyId],
        10000,
      )
      return result.rows.map((r) => {
        let aliases: string[] = []
        try { aliases = r.aliases ? JSON.parse(r.aliases) : [] } catch { /* */ }
        return {
          term_id: r.term_id,
          value: r.value,
          label: r.label || r.value,
          aliases,
        }
      })
    },
    enabled: !!terminologyId,
    staleTime: 5 * 60 * 1000,
  })

  // Build resolution map: lowercase string → ResolvedTerm
  const resolutionMap = useMemo(() => {
    const map = new Map<string, ResolvedTerm>()
    for (const t of terms ?? []) {
      const resolved: ResolvedTerm = {
        canonical: t.value,
        termId: t.term_id,
        label: t.label,
        aliases: t.aliases,
      }
      map.set(t.value.toLowerCase(), resolved)
      for (const alias of t.aliases) {
        map.set(alias.toLowerCase(), resolved)
      }
    }
    return map
  }, [terms])

  const resolve = (raw: string): ResolvedTerm | null => {
    return resolutionMap.get(raw.toLowerCase()) ?? null
  }

  return {
    resolve,
    resolutionMap,
    terminologyId: terminologyId ?? null,
    termCount: terms?.length ?? 0,
    isLoading: !terminologyId || !terms,
  }
}

/**
 * Merge AE frequency rows that resolve to the same canonical term.
 * Rows with no resolution are kept as-is.
 */
export function mergeResolvedRows<T extends { term: string; trial_count: number; report_count: number }>(
  rows: T[],
  resolve: (raw: string) => ResolvedTerm | null,
): T[] {
  const merged = new Map<string, T>()

  for (const row of rows) {
    const resolved = resolve(row.term)
    const key = resolved ? resolved.canonical.toLowerCase() : row.term.toLowerCase()

    if (merged.has(key)) {
      const existing = merged.get(key)!
      merged.set(key, {
        ...existing,
        trial_count: existing.trial_count + row.trial_count,
        report_count: existing.report_count + row.report_count,
        term: resolved?.label ?? existing.term,
      })
    } else {
      merged.set(key, {
        ...row,
        term: resolved?.label ?? row.term,
      })
    }
  }

  return [...merged.values()]
}
