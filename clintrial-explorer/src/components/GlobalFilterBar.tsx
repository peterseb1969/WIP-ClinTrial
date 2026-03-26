import { useNavigate } from 'react-router-dom'
import { X, Filter, ArrowRight } from 'lucide-react'
import { useTrialFilters, type MultiFilterKey, type SingleFilterKey } from '@/hooks/useTrialFilters'
import { trialFilters } from '@/hooks/useTrialFilters'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { formatNumber } from '@/lib/utils'

export function GlobalFilterBar() {
  const { hasActive, activeEntries, clearAll } = useTrialFilters()
  const { trials } = useFilteredTrials()
  const navigate = useNavigate()

  if (!hasActive) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <span className="text-xs font-medium text-primary">
        <Filter className="mr-1 inline h-3 w-3" />
        {formatNumber(trials.length)} trials:
      </span>
      {activeEntries.map(({ key, value }) => (
        <button
          key={`${key}:${value}`}
          onClick={() => {
            const multiKeys = new Set(['status', 'phase', 'study_type', 'therapeutic_area', 'molecule', 'condition', 'sponsor', 'country'])
            if (multiKeys.has(key)) {
              trialFilters.removeValue(key as MultiFilterKey, value)
            } else {
              trialFilters.removeKey(key as SingleFilterKey)
            }
          }}
          className="inline-flex items-center gap-1 rounded-full bg-primary text-white px-2.5 py-1 text-xs font-medium hover:bg-primary/80"
        >
          {key}: {value}
          <X className="h-3 w-3" />
        </button>
      ))}
      <button
        onClick={() => navigate('/trials')}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
      >
        View trials <ArrowRight className="h-3 w-3" />
      </button>
      <button
        onClick={clearAll}
        className="ml-auto text-xs text-primary hover:text-danger font-medium"
      >
        Clear all
      </button>
    </div>
  )
}
