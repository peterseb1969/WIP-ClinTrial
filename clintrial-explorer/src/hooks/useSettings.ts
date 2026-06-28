import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { serverApiUrl } from '@/lib/config'

export interface AppSettings {
  sync_enabled: boolean
  sync_interval_hours: number
}

export function useSettings() {
  return useQuery<AppSettings>({
    queryKey: ['clintrial', 'settings'],
    queryFn: async () => {
      const res = await fetch(serverApiUrl('/settings'))
      if (!res.ok) throw new Error(`Failed to load settings: ${res.status}`)
      return res.json()
    },
    staleTime: 30_000,
  })
}

export function useUpdateSettings() {
  const queryClient = useQueryClient()
  return useMutation<AppSettings, Error, AppSettings>({
    mutationFn: async (settings) => {
      const res = await fetch(serverApiUrl('/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error(`Failed to save settings: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clintrial', 'settings'] })
    },
  })
}

// --- Anthropic API key (admin-only runtime config; key is write-only) ---

export interface AnthropicKeyStatus {
  configured: boolean
  source: 'override' | 'file' | 'env' | 'none'
  last4: string | null
  persisted?: boolean
}

export function useAnthropicKeyStatus() {
  return useQuery<AnthropicKeyStatus | { forbidden: true }>({
    queryKey: ['clintrial', 'anthropic-key'],
    queryFn: async () => {
      const res = await fetch(serverApiUrl('/config/anthropic-key'))
      if (res.status === 403) return { forbidden: true }
      if (!res.ok) throw new Error(`Failed to load key status: ${res.status}`)
      return res.json()
    },
    staleTime: 30_000,
  })
}

export function useSetAnthropicKey() {
  const queryClient = useQueryClient()
  return useMutation<AnthropicKeyStatus, Error, { key: string; persist: boolean }>({
    mutationFn: async ({ key, persist }) => {
      const res = await fetch(serverApiUrl('/config/anthropic-key'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, persist }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `Request failed: ${res.status}`)
      return body
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clintrial', 'anthropic-key'] })
    },
  })
}
