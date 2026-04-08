import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface AECleanupStats {
  raw_term_count: number
  existing_term_count: number
  unmapped_count: number
  case_collapsed_count: number
  unique_lowercase_count: number
}

/** Cheap counts-only preview — no Claude call, no cost. */
export function useAECleanupStats(enabled: boolean) {
  return useQuery<AECleanupStats>({
    queryKey: ['clintrial', 'ae-cleanup-stats'],
    queryFn: async () => {
      const res = await fetch('/server-api/ae-cleanup/stats')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled,
    staleTime: 60 * 1000,
  })
}

export interface AECleanupCluster {
  canonical: string
  variants: string[]
  confidence: number
  reason: string
  existing_canonical: string | null
}

export interface AECleanupProposeResponse {
  clusters: AECleanupCluster[]
  stats: {
    raw_term_count: number
    existing_term_count: number
    unmapped_count: number
    sent_to_claude?: number
    truncated?: boolean
    usage: { input_tokens: number; output_tokens: number } | null
  }
}

export interface AECleanupApplyResponse {
  applied: number
  created: number
  updated: number
  deleted: number
  errors: Array<{ cluster: string; error: string }>
}

/** Call Claude to propose AE term clusters. */
export function useProposeAECleanup() {
  return useMutation<AECleanupProposeResponse, Error, { maxTerms?: number } | void>({
    mutationFn: async (vars) => {
      const res = await fetch('/server-api/ae-cleanup/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxTerms: vars?.maxTerms }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
  })
}

/** Apply approved clusters. Invalidates AE caches on success. */
export function useApplyAECleanup() {
  const qc = useQueryClient()
  return useMutation<AECleanupApplyResponse, Error, AECleanupCluster[]>({
    mutationFn: async (clusters) => {
      const res = await fetch('/server-api/ae-cleanup/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusters }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clintrial', 'ae-terms-all'] })
      qc.invalidateQueries({ queryKey: ['clintrial', 'ae-frequency'] })
      qc.invalidateQueries({ queryKey: ['clintrial', 'ae-severity'] })
    },
  })
}
