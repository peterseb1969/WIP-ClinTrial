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
