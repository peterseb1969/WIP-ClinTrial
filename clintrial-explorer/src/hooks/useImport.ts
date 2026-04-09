import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export interface ImportProgress {
  phase: string
  step: string
  processed: number
  total: number
  current_nct_id?: string
  counts: {
    orgs_created: number
    orgs_updated: number
    trials_created: number
    trials_updated: number
    trials_skipped: number
    outcomes_created: number
    outcomes_updated: number
    sites_created: number
    sites_updated: number
    aes_created: number
    aes_updated: number
    baselines_created: number
    baselines_updated: number
    files_uploaded: number
    errors: number
    error_log?: string[]
    warnings: number
    warning_log?: string[]
  }
}

export interface ImportOptions {
  mode: 'incremental' | 'full'
  sponsors?: string[]
  nctIds?: string[]
  sinceDate?: string
  limit?: number
  skipPdfs?: boolean
}

/** Hook to manage an import job via SSE with polling fallback */
export function useImportJob() {
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const queryClient = useQueryClient()

  // Check for already-running job on mount
  useEffect(() => {
    let cancelled = false
    fetch('/server-api/import/status')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        if (data.job?.status === 'running') {
          setIsRunning(true)
          setProgress(data.job.progress)
          startPolling()
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch('/server-api/import/status')
        const data = await res.json()
        if (!data.job) return

        if (data.job.status === 'running') {
          setProgress(data.job.progress)
        } else if (data.job.status === 'completed') {
          setProgress(data.job.progress)
          setCompleted(true)
          setIsRunning(false)
          stopPolling()
          queryClient.invalidateQueries({ queryKey: ['clintrial'] })
          queryClient.invalidateQueries({ queryKey: ['import', 'sync-state'] })
        } else if (data.job.status === 'error' || data.job.status === 'cancelled') {
          setProgress(data.job.progress)
          setError(data.job.status === 'cancelled' ? 'Import cancelled' : 'Import failed')
          setIsRunning(false)
          stopPolling()
        }
      } catch {
        // ignore polling errors
      }
    }, 2000)
  }, [stopPolling, queryClient])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  const start = useCallback(
    async (options: ImportOptions) => {
      setIsRunning(true)
      setProgress(null)
      setError(null)
      setCompleted(false)

      // Start polling immediately as fallback
      startPolling()

      try {
        const response = await fetch('/server-api/import/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options),
        })

        if (response.status === 409) {
          const data = await response.json()
          setError(data.error || 'An import is already running')
          setIsRunning(false)
          stopPolling()
          return
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (!response.body) throw new Error('No response body')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let eventType = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim()
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                switch (eventType) {
                  case 'progress':
                    setProgress(data)
                    break
                  case 'complete':
                    if (data.counts) {
                      setProgress((prev) => prev ? { ...prev, counts: data.counts } : null)
                    }
                    setCompleted(true)
                    setIsRunning(false)
                    stopPolling()
                    queryClient.invalidateQueries({ queryKey: ['clintrial'] })
                    queryClient.invalidateQueries({ queryKey: ['import', 'sync-state'] })
                    break
                  case 'error':
                    setError(data.message)
                    setIsRunning(false)
                    stopPolling()
                    break
                }
              } catch {
                // skip
              }
              eventType = ''
            }
          }
        }
      } catch {
        // SSE connection lost — polling will take over
        // Don't set error or stop, the job continues server-side
      }
    },
    [queryClient, startPolling, stopPolling],
  )

  const cancel = useCallback(async () => {
    try {
      await fetch('/server-api/import/cancel', { method: 'POST' })
    } catch {
      // ignore
    }
  }, [])

  const reset = useCallback(() => {
    setProgress(null)
    setError(null)
    setCompleted(false)
    stopPolling()
  }, [stopPolling])

  return { start, cancel, reset, isRunning, progress, error, completed }
}

/** Hook to poll import job status */
export function useImportStatus() {
  return useQuery({
    queryKey: ['import', 'status'],
    queryFn: async () => {
      const res = await fetch('/server-api/import/status')
      if (!res.ok) return null
      const data = await res.json()
      return data.job
    },
    refetchInterval: 5000,
  })
}

/** Hook to fetch sync state */
export function useSyncState() {
  return useQuery({
    queryKey: ['import', 'sync-state'],
    queryFn: async () => {
      const res = await fetch('/server-api/import/sync-state')
      if (!res.ok) throw new Error('Failed to fetch sync state')
      return res.json()
    },
    staleTime: 30 * 1000,
  })
}
