import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { PageLoading } from '@/components/LoadingSpinner'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useTrialFilters } from '@/hooks/useTrialFilters'
import { useFilterToggle } from '@/hooks/useFilterNav'
import { cn, formatNumber } from '@/lib/utils'

interface TAGroup {
  area: string
  trialCount: number
  conditions: Array<{ name: string; count: number }>
}

export function TherapeuticAreasPage() {
  const { trials: filtered, isLoading } = useFilteredTrials()
  const { filters } = useTrialFilters()
  const toggleFilter = useFilterToggle()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const selectedAreas = filters.therapeutic_area ?? []

  // Build TA → conditions mapping from filtered trials
  const groups = useMemo(() => {
    const areaMap = new Map<string, { trials: Set<string>; conditions: Map<string, number> }>()

    for (const t of filtered) {
      const areas = t.data.therapeutic_areas ?? []
      const conditions = t.data.conditions ?? []

      for (const area of areas) {
        if (!areaMap.has(area)) {
          areaMap.set(area, { trials: new Set(), conditions: new Map() })
        }
        const entry = areaMap.get(area)!
        entry.trials.add(t.data.nct_id)
        for (const cond of conditions) {
          entry.conditions.set(cond, (entry.conditions.get(cond) || 0) + 1)
        }
      }
    }

    const result: TAGroup[] = [...areaMap.entries()].map(([area, data]) => ({
      area,
      trialCount: data.trials.size,
      conditions: [...data.conditions.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    }))

    return result.sort((a, b) => b.trialCount - a.trialCount)
  }, [filtered])

  // Trials with no therapeutic area
  const unclassified = useMemo(() => {
    return filtered.filter((t) => !t.data.therapeutic_areas || t.data.therapeutic_areas.length === 0)
  }, [filtered])

  const unclassifiedConditions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of unclassified) {
      for (const c of t.data.conditions ?? []) {
        counts.set(c, (counts.get(c) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [unclassified])

  const searchFiltered = useMemo(() => {
    if (!search) return groups
    const q = search.toLowerCase()
    return groups.filter(
      (g) =>
        g.area.toLowerCase().includes(q) ||
        g.conditions.some((c) => c.name.toLowerCase().includes(q)),
    )
  }, [groups, search])

  const toggleExpand = (area: string) => {
    const next = new Set(expanded)
    if (next.has(area)) next.delete(area)
    else next.add(area)
    setExpanded(next)
  }

  if (isLoading) return <PageLoading message="Loading therapeutic areas..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Therapeutic Areas</h1>
        <span className="text-sm text-text-muted">
          {groups.length} areas · {formatNumber(filtered.length)} trials
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Search areas or conditions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-surface py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="space-y-2">
        {searchFiltered.map((group) => {
          const isExpanded = expanded.has(group.area)
          const isSelected = selectedAreas.includes(group.area)

          return (
            <Card
              key={group.area}
              className={cn(
                'p-0 overflow-hidden transition-all',
                isSelected && 'ring-2 ring-primary border-primary',
                selectedAreas.length > 0 && !isSelected && 'opacity-50',
              )}
            >
              {/* Header — click to expand */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/50"
                onClick={() => toggleExpand(group.area)}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm">
                    {group.area.replace(/_/g, ' ')}
                  </span>
                </div>
                <Badge variant={isSelected ? 'primary' : 'default'}>
                  {formatNumber(group.trialCount)} trials
                </Badge>
                <Badge variant="muted">{group.conditions.length} conditions</Badge>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFilter('therapeutic_area', group.area)
                  }}
                  className={cn(
                    'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    isSelected
                      ? 'bg-primary text-white hover:bg-primary/80'
                      : 'bg-primary/10 text-primary hover:bg-primary/20',
                  )}
                >
                  {isSelected ? 'Selected' : 'Filter'}
                </button>
              </div>

              {/* Expanded conditions list */}
              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-50/30 px-4 py-3">
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {group.conditions.map((cond) => (
                      <button
                        key={cond.name}
                        onClick={() => toggleFilter('condition', cond.name)}
                        className={cn(
                          'flex items-center justify-between rounded-md px-2 py-1 text-xs text-left transition-colors',
                          (filters.condition ?? []).includes(cond.name)
                            ? 'bg-primary text-white'
                            : 'hover:bg-gray-100',
                        )}
                      >
                        <span className="truncate pr-2">{cond.name}</span>
                        <span className="flex-shrink-0 tabular-nums text-[10px] opacity-70">
                          {cond.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )
        })}

        {/* Unclassified trials */}
        {unclassified.length > 0 && (
          <Card
            className={cn(
              'p-0 overflow-hidden border-dashed',
              selectedAreas.length > 0 && 'opacity-50',
            )}
          >
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/50"
              onClick={() => toggleExpand('__unclassified__')}
            >
              {expanded.has('__unclassified__') ? (
                <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0" />
              )}
              <span className="font-semibold text-sm text-text-muted">Unclassified</span>
              <Badge variant="muted">{formatNumber(unclassified.length)} trials</Badge>
              <Badge variant="muted">{unclassifiedConditions.length} conditions</Badge>
            </div>
            {expanded.has('__unclassified__') && (
              <div className="border-t border-gray-100 bg-gray-50/30 px-4 py-3">
                <p className="mb-2 text-xs text-text-muted">
                  Trials with conditions that don't match any therapeutic area keyword.
                </p>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {unclassifiedConditions.slice(0, 30).map((cond) => (
                    <button
                      key={cond.name}
                      onClick={() => toggleFilter('condition', cond.name)}
                      className="flex items-center justify-between rounded-md px-2 py-1 text-xs text-left hover:bg-gray-100"
                    >
                      <span className="truncate pr-2">{cond.name}</span>
                      <span className="flex-shrink-0 tabular-nums text-[10px] opacity-70">
                        {cond.count}
                      </span>
                    </button>
                  ))}
                  {unclassifiedConditions.length > 30 && (
                    <span className="text-xs text-text-muted px-2 py-1">
                      +{unclassifiedConditions.length - 30} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
