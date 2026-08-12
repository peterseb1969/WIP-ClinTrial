import { useQuery } from '@tanstack/react-query'
import { serverApiUrl } from '@/lib/config'

export type AppRole = 'admin' | 'user' | 'none'

export interface CurrentUser {
  user: string | null
  groups: string[]
  role: AppRole
  isAdmin: boolean
  authEnabled: boolean
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const res = await fetch(serverApiUrl('/me'))
      if (!res.ok) throw new Error(`Failed to fetch user: ${res.status}`)
      return (await res.json()) as CurrentUser
    },
    staleTime: 300000,
  })
}
