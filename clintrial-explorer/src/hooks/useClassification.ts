import { useState, useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { serverApiUrl } from '@/lib/config'

export interface ClassificationResultItem {
  nct_id: string
  document_id: string
  old_tas: string[]
  new_tas: string[]
  provenance: Array<{
    rule_document_id: string
    rule_pattern: string
    match_type: string
    action: string
    matched_condition: string
    target_ta: string
    inherited_from?: string
  }>
  pinned: boolean
  changed: boolean
}

export interface ClassificationProgress {
  phase: string
  message: string
  total?: number
  processed?: number
}

export interface ClassificationSummary {
  total: number
  changed: number
  pinned: number
  unchanged: number
  dryRun: boolean
  write_failed?: number
  write_errors?: { nct_id: string; error: string }[]
}

/** Hook to run server-side classification via SSE */
export function useRunClassification() {
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<ClassificationProgress | null>(null)
  const [results, setResults] = useState<ClassificationResultItem[]>([])
  const [summary, setSummary] = useState<ClassificationSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const queryClient = useQueryClient()

  const run = useCallback(
    async (opts: { trialIds?: string[]; dryRun?: boolean }) => {
      setIsRunning(true)
      setResults([])
      setSummary(null)
      setError(null)

      try {
        // Use fetch with POST to start SSE (EventSource only supports GET)
        const response = await fetch(serverApiUrl('/classify'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts),
        })

        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (!response.body) throw new Error('No response body')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // Keep incomplete line

          let eventType = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                switch (eventType) {
                  case 'status':
                    setProgress(data)
                    break
                  case 'progress':
                    setProgress((prev) => ({
                      ...prev,
                      phase: 'classifying',
                      message: `${data.processed}/${data.total}`,
                      ...data,
                    }))
                    break
                  case 'result':
                    if (data.changed || data.pinned) {
                      setResults((prev) => [...prev, data])
                    }
                    break
                  case 'complete':
                    setSummary(data)
                    break
                  case 'error':
                    setError(data.message)
                    break
                }
              } catch {
                // skip unparseable data
              }
            }
          }
        }

        // Invalidate trial queries after successful classification
        queryClient.invalidateQueries({ queryKey: ['clintrial'] })
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setIsRunning(false)
      }
    },
    [queryClient],
  )

  const cancel = useCallback(() => {
    eventSourceRef.current?.close()
    setIsRunning(false)
  }, [])

  return { run, cancel, isRunning, progress, results, summary, error }
}

/** Hook to pin/unpin a trial's therapeutic areas */
export function usePinTrial() {
  return useMutation({
    mutationFn: async (opts: {
      nct_id: string
      pinned: boolean
      therapeutic_areas?: string[]
    }) => {
      const res = await fetch(serverApiUrl('/pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      })
      if (!res.ok) throw new Error(`Pin failed: ${res.status}`)
      return res.json()
    },
    // No blanket delayed invalidation here: the caller (TrialDetailPage)
    // confirms reporting-sync visibility via refetchUntil on the cheap
    // single-trial query, then invalidates — deterministic ordering instead
    // of a 3s guess (CASE-727).
  })
}
