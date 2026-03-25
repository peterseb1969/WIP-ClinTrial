import { useNavigate } from 'react-router-dom'
import { X, Filter } from 'lucide-react'
import { useTrialFilters } from '@/hooks/useTrialFilters'

export function GlobalFilterBar() {
  const { hasActive, activeEntries, set, clearAll } = useTrialFilters()
  const navigate = useNavigate()

  if (!hasActive) return null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      <button
        onClick={() => navigate('/trials')}
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <Filter className="h-3 w-3" />
        Showing trials:
      </button>
      {activeEntries.map(([key, value]) => (
        <button
          key={key}
          onClick={() => set(key, null)}
          className="inline-flex items-center gap-1 rounded-full bg-primary text-white px-2.5 py-1 text-xs font-medium hover:bg-primary/80"
        >
          {key}: {value}
          <X className="h-3 w-3" />
        </button>
      ))}
      <button
        onClick={clearAll}
        className="ml-auto text-xs text-primary hover:text-danger font-medium"
      >
        Clear all
      </button>
    </div>
  )
}
