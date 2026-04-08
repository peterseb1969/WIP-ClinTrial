import { useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { X, Filter, ArrowRight, GitCompare } from 'lucide-react'
import { useTrialFilters, type MultiFilterKey, type SingleFilterKey } from '@/hooks/useTrialFilters'
import { trialFilters } from '@/hooks/useTrialFilters'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { formatNumber } from '@/lib/utils'

const LABEL_MAP: Record<string, string> = {
  status: 'Status',
  phase: 'Phase',
  study_type: 'Study Type',
  therapeutic_area: 'TA',
  molecule: 'Molecule',
  condition: 'Condition',
  sponsor: 'Sponsor',
  country: 'Country',
  nct_id: 'Trials',
  has_results: 'Has Results',
  has_ae_data: 'Has AE Data',
  has_baseline: 'Has Baseline',
  has_outcomes: 'Has Outcomes',
  has_protocol: 'Has Protocol',
  bookmarked: 'Bookmarked',
  search: 'Search',
}

const MULTI_KEYS = new Set(['status', 'phase', 'study_type', 'therapeutic_area', 'molecule', 'condition', 'sponsor', 'country', 'nct_id'])

function formatValue(value: string) {
  return value.replace(/_/g, ' ')
}

/** Persistent bar showing active global filters grouped by key, with contextual actions */
export function GlobalFilterBar() {
  const { hasActive, activeEntries, clearAll, filters } = useTrialFilters()
  const { trials } = useFilteredTrials()
  const navigate = useNavigate()
  const location = useLocation()

  // Group entries by key
  const grouped = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const { key, value } of activeEntries) {
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(value)
    }
    return map
  }, [activeEntries])

  const moleculeCount = filters.molecule?.length ?? 0
  const onMoleculesPage = location.pathname.startsWith('/molecules')

  if (!hasActive) return null

  return (
    <div className="space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
      {/* Top line: trial count + actions */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-primary">
          <Filter className="mr-1 inline h-3 w-3" />
          {formatNumber(trials.length)} trials
        </span>

        <div className="flex items-center gap-2 ml-auto">
          {moleculeCount >= 2 && !onMoleculesPage && (
            <button
              onClick={() => navigate('/molecules/compare')}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
            >
              <GitCompare className="h-3 w-3" /> Compare {moleculeCount} molecules
            </button>
          )}
          <button
            onClick={() => navigate('/trials')}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
          >
            View trials <ArrowRight className="h-3 w-3" />
          </button>
          <button
            onClick={clearAll}
            className="text-xs text-primary hover:text-danger font-medium"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* Grouped filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[...grouped.entries()].map(([key, values]) => (
          <div key={key} className="inline-flex items-center gap-0.5">
            <span className="text-[10px] text-primary/70 font-medium mr-0.5">
              {LABEL_MAP[key] || key}:
            </span>
            {key === 'nct_id' ? (
              /* Show NCT ID filter as a summary chip, not individual IDs */
              <button
                onClick={() => trialFilters.removeKey(key as MultiFilterKey)}
                className="inline-flex items-center gap-0.5 rounded-full bg-primary text-white px-2 py-0.5 text-[11px] font-medium hover:bg-primary/80"
              >
                {values.length} selected
                <X className="h-2.5 w-2.5" />
              </button>
            ) : (
              values.map((value) => (
                <button
                  key={`${key}:${value}`}
                  onClick={() => {
                    if (MULTI_KEYS.has(key)) {
                      trialFilters.removeValue(key as MultiFilterKey, value)
                    } else {
                      trialFilters.removeKey(key as SingleFilterKey)
                    }
                  }}
                  className="inline-flex items-center gap-0.5 rounded-full bg-primary text-white px-2 py-0.5 text-[11px] font-medium hover:bg-primary/80"
                >
                  {key === 'search' ? `"${value}"` : formatValue(value)}
                  <X className="h-2.5 w-2.5" />
                </button>
              ))
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
