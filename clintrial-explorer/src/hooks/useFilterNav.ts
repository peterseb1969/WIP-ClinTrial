import { useCallback } from 'react'
import { trialFilters, type FilterKey } from '@/hooks/useTrialFilters'

/** Toggle a filter value without navigating. Stays on the current page. */
export function useFilterToggle() {
  return useCallback(
    (key: FilterKey, value: string) => trialFilters.toggle(key, value),
    [],
  )
}
