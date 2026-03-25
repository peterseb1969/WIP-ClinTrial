import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { trialFilters, type FilterKey } from '@/hooks/useTrialFilters'

/** Navigate to the Trials page with a filter added to the global filter state */
export function useFilterNav() {
  const navigate = useNavigate()

  const addFilter = useCallback(
    (key: FilterKey, value: string) => {
      trialFilters.set(key, value)
      navigate('/trials')
    },
    [navigate],
  )

  return addFilter
}
