import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { PageLoading } from '@/components/LoadingSpinner'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useTrialFilters, type FilterKey } from '@/hooks/useTrialFilters'
import { useTherapeuticAreaTree, type TANode } from '@/hooks/useTherapeuticAreaTree'
import { useTherapeuticAreaTerms, buildKeywordMap, conditionMatchesArea } from '@/hooks/useTherapeuticAreaTerms'
import { useFilterToggle } from '@/hooks/useFilterNav'
import { useClassificationRules, applyRules } from '@/hooks/useClassificationRules'
import { deduplicateConditions } from '@/lib/trial-utils'
import { cn, formatNumber } from '@/lib/utils'

export function TherapeuticAreasPage() {
  const { trials: filtered, isLoading: loadingTrials } = useFilteredTrials()
  const { filters } = useTrialFilters()
  const { data: tree, isLoading: loadingTree } = useTherapeuticAreaTree()
  const { data: taTerms } = useTherapeuticAreaTerms()
  const { data: rules } = useClassificationRules()
  const toggleFilter = useFilterToggle()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const selectedAreas = filters.therapeutic_area ?? []

  // Keyword map for filtering conditions to relevant area
  const keywordMap = useMemo(() => buildKeywordMap(taTerms ?? []), [taTerms])

  // Build TA → {trialCount, conditions} from filtered trials
  // Include conditions that match keywords OR were mapped via classification rules
  const areaStats = useMemo(() => {
    // Build a set of rule-mapped condition→TA pairs for fast lookup
    const ruleMapped = new Set<string>() // "condition|TA" pairs
    if (rules && rules.length > 0) {
      for (const t of filtered) {
        for (const cond of t.data.conditions ?? []) {
          const { add } = applyRules([cond], rules, t.data.nct_id)
          for (const ta of add) {
            ruleMapped.add(`${cond}|${ta}`)
          }
        }
      }
    }

    const map = new Map<string, { trials: Set<string>; conditions: Map<string, number> }>()
    for (const t of filtered) {
      for (const area of t.data.therapeutic_areas ?? []) {
        if (!map.has(area)) map.set(area, { trials: new Set(), conditions: new Map() })
        const entry = map.get(area)!
        entry.trials.add(t.data.nct_id)
        for (const cond of t.data.conditions ?? []) {
          if (conditionMatchesArea(cond, area, keywordMap) || ruleMapped.has(`${cond}|${area}`)) {
            entry.conditions.set(cond, (entry.conditions.get(cond) || 0) + 1)
          }
        }
      }
    }
    return map
  }, [filtered, keywordMap, rules])

  // Unclassified trials
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
    return deduplicateConditions(
      [...counts.entries()].map(([name, count]) => ({ name, count })),
    ).sort((a, b) => a.name.localeCompare(b.name))
  }, [unclassified])

  const toggleExpand = (area: string) => {
    const next = new Set(expanded)
    if (next.has(area)) next.delete(area)
    else next.add(area)
    setExpanded(next)
  }

  // Flat list of all areas with stats (must be before any early return)
  const flatAreas = useMemo(() => {
    return [...areaStats.entries()]
      .map(([area, data]) => ({
        area,
        trialCount: data.trials.size,
        conditions: deduplicateConditions(
          [...data.conditions.entries()].map(([name, count]) => ({ name, count })),
        ),
      }))
      .sort((a, b) => a.area.localeCompare(b.area))
  }, [areaStats])

  // Search filters
  const matchesSearch = (value: string) => {
    if (!search) return true
    const q = search.toLowerCase()
    return value.toLowerCase().replace(/_/g, ' ').includes(q)
  }

  if (loadingTrials || loadingTree) return <PageLoading message="Loading therapeutic areas..." />

  // If we have an ontology tree, render it; otherwise fall back to flat list
  const roots = tree && tree.length > 0 ? tree : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Therapeutic Areas</h1>
        <span className="text-sm text-text-muted">
          {flatAreas.length} areas · {formatNumber(filtered.length)} trials
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
        {roots ? (
          // Ontology tree view
          roots.map((node) => (
            <TreeNode
              key={node.value}
              node={node}
              depth={0}
              areaStats={areaStats}
              selectedAreas={selectedAreas}
              expanded={expanded}
              toggleExpand={toggleExpand}
              toggleFilter={toggleFilter}
              matchesSearch={matchesSearch}
              search={search}
            />
          ))
        ) : (
          // Flat fallback
          flatAreas
            .filter((g) => matchesSearch(g.area))
            .map((group) => (
              <AreaCard
                key={group.area}
                area={group.area}
                trialCount={group.trialCount}
                conditions={group.conditions}
                isSelected={selectedAreas.includes(group.area)}
                isDimmed={selectedAreas.length > 0 && !selectedAreas.includes(group.area)}
                isExpanded={expanded.has(group.area)}
                toggleExpand={() => toggleExpand(group.area)}
                toggleFilter={() => toggleFilter('therapeutic_area', group.area)}
                toggleCondition={(c: string) => toggleFilter('condition', c)}
                selectedConditions={filters.condition ?? []}
              />
            ))
        )}

        {/* Unclassified */}
        {unclassified.length > 0 && (
          <Card className={cn('p-0 overflow-hidden border-dashed', selectedAreas.length > 0 && 'opacity-50')}>
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
                <ConditionGrid
                  conditions={expanded.has('__unclassified_all__') ? unclassifiedConditions : unclassifiedConditions.slice(0, 30)}
                  selectedConditions={filters.condition ?? []}
                  toggleCondition={(c) => toggleFilter('condition', c)}
                />
                {unclassifiedConditions.length > 30 && (
                  <button
                    onClick={() => toggleExpand('__unclassified_all__')}
                    className="mt-2 text-xs font-medium text-primary hover:underline"
                  >
                    {expanded.has('__unclassified_all__') ? 'Show less' : `Show all ${unclassifiedConditions.length} conditions`}
                  </button>
                )}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}

/** Recursive tree node for the ontology hierarchy */
function TreeNode({
  node,
  depth,
  areaStats,
  selectedAreas,
  expanded,
  toggleExpand,
  toggleFilter,
  matchesSearch,
  search,
}: {
  node: TANode
  depth: number
  areaStats: Map<string, { trials: Set<string>; conditions: Map<string, number> }>
  selectedAreas: string[]
  expanded: Set<string>
  toggleExpand: (area: string) => void
  toggleFilter: (key: FilterKey, value: string) => void
  matchesSearch: (value: string) => boolean
  search: string
}) {
  const stats = areaStats.get(node.value)
  const trialCount = stats?.trials.size ?? 0
  const conditions = stats
    ? deduplicateConditions([...stats.conditions.entries()].map(([name, count]) => ({ name, count }))).sort((a, b) => a.name.localeCompare(b.name))
    : []

  // Include children's trial counts for parent display
  const childTrialCount = node.children.reduce((sum, child) => {
    const cs = areaStats.get(child.value)
    return sum + (cs?.trials.size ?? 0)
  }, 0)

  const totalTrials = trialCount + childTrialCount
  const isSelected = selectedAreas.includes(node.value)
  const isDimmed = selectedAreas.length > 0 && !isSelected && !node.children.some((c) => selectedAreas.includes(c.value))
  const isExpanded = expanded.has(node.value)
  const hasChildren = node.children.length > 0

  // Skip if doesn't match search and no children match
  if (search && !matchesSearch(node.value) && !node.children.some((c) => matchesSearch(c.value))) {
    return null
  }

  // Skip areas with 0 trials (and 0 child trials)
  if (totalTrials === 0 && !search) return null

  return (
    <div style={{ marginLeft: depth * 16 }}>
      <Card
        className={cn(
          'p-0 overflow-hidden transition-all',
          isSelected && 'ring-2 ring-primary border-primary',
          isDimmed && 'opacity-50',
        )}
      >
        <div
          className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-gray-50/50"
          onClick={() => hasChildren || conditions.length > 0 ? toggleExpand(node.value) : toggleFilter('therapeutic_area', node.value)}
        >
          {(hasChildren || conditions.length > 0) ? (
            isExpanded ? <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
                       : <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0" />
          ) : (
            <div className="w-4" />
          )}

          <span className={cn('font-semibold text-sm flex-1', depth === 0 && 'text-base')}>
            {node.label}
          </span>

          {trialCount > 0 && (
            <Badge variant={isSelected ? 'primary' : 'default'}>
              {formatNumber(trialCount)} direct
            </Badge>
          )}
          {childTrialCount > 0 && (
            <Badge variant="muted">
              {formatNumber(childTrialCount)} in subtypes
            </Badge>
          )}
          {conditions.length > 0 && (
            <Badge variant="muted">{conditions.length} conditions</Badge>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleFilter('therapeutic_area', node.value)
            }}
            className={cn(
              'rounded-md px-2 py-1 text-xs font-medium transition-colors',
              isSelected
                ? 'bg-primary text-white hover:bg-primary/80'
                : 'bg-primary/10 text-primary hover:bg-primary/20',
            )}
          >
            {isSelected ? '✓ Selected' : 'Filter'}
          </button>
        </div>

        {/* Expanded: show conditions with show-all toggle */}
        {isExpanded && conditions.length > 0 && (
          <ExpandableConditions
            conditions={conditions}
            selectedConditions={[]}
            toggleCondition={(c) => toggleFilter('condition', c)}
          />
        )}
      </Card>

      {/* Render children when expanded */}
      {isExpanded && node.children.map((child) => (
        <TreeNode
          key={child.value}
          node={child}
          depth={depth + 1}
          areaStats={areaStats}
          selectedAreas={selectedAreas}
          expanded={expanded}
          toggleExpand={toggleExpand}
          toggleFilter={toggleFilter}
          matchesSearch={matchesSearch}
          search={search}
        />
      ))}
    </div>
  )
}

function AreaCard({
  area, trialCount, conditions, isSelected, isDimmed, isExpanded,
  toggleExpand, toggleFilter, toggleCondition, selectedConditions,
}: {
  area: string; trialCount: number; conditions: Array<{ name: string; count: number }>
  isSelected: boolean; isDimmed: boolean; isExpanded: boolean
  toggleExpand: () => void; toggleFilter: () => void
  toggleCondition: (c: string) => void; selectedConditions: string[]
}) {
  return (
    <Card className={cn('p-0 overflow-hidden transition-all', isSelected && 'ring-2 ring-primary border-primary', isDimmed && 'opacity-50')}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/50" onClick={toggleExpand}>
        {isExpanded ? <ChevronDown className="h-4 w-4 text-text-muted" /> : <ChevronRight className="h-4 w-4 text-text-muted" />}
        <span className="font-semibold text-sm flex-1">{area.replace(/_/g, ' ')}</span>
        <Badge variant={isSelected ? 'primary' : 'default'}>{formatNumber(trialCount)} trials</Badge>
        <Badge variant="muted">{conditions.length} conditions</Badge>
        <button
          onClick={(e) => { e.stopPropagation(); toggleFilter() }}
          className={cn('rounded-md px-2 py-1 text-xs font-medium', isSelected ? 'bg-primary text-white' : 'bg-primary/10 text-primary')}
        >
          {isSelected ? '✓ Selected' : 'Filter'}
        </button>
      </div>
      {isExpanded && (
        <div className="border-t border-gray-100 bg-gray-50/30 px-4 py-3">
          <ConditionGrid conditions={conditions} selectedConditions={selectedConditions} toggleCondition={toggleCondition} />
        </div>
      )}
    </Card>
  )
}

const INITIAL_CONDITION_LIMIT = 20

function ExpandableConditions({
  conditions, selectedConditions, toggleCondition,
}: {
  conditions: Array<{ name: string; count: number }>
  selectedConditions: string[]
  toggleCondition: (c: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? conditions : conditions.slice(0, INITIAL_CONDITION_LIMIT)
  const hasMore = conditions.length > INITIAL_CONDITION_LIMIT

  return (
    <div className="border-t border-gray-100 bg-gray-50/30 px-4 py-2">
      <ConditionGrid conditions={visible} selectedConditions={selectedConditions} toggleCondition={toggleCondition} />
      {hasMore && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-2 text-xs font-medium text-primary hover:underline"
        >
          {showAll ? 'Show less' : `Show all ${conditions.length} conditions`}
        </button>
      )}
    </div>
  )
}

function ConditionGrid({
  conditions, selectedConditions, toggleCondition,
}: {
  conditions: Array<{ name: string; count: number }>
  selectedConditions: string[]
  toggleCondition: (c: string) => void
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
      {conditions.map((cond) => (
        <button
          key={cond.name}
          onClick={() => toggleCondition(cond.name)}
          className={cn(
            'flex items-center justify-between rounded-md px-2 py-1 text-xs text-left transition-colors',
            selectedConditions.includes(cond.name)
              ? 'bg-primary text-white'
              : 'hover:bg-gray-100',
          )}
        >
          <span className="truncate pr-2">{cond.name}</span>
          <span className="flex-shrink-0 tabular-nums text-[10px] opacity-70">{cond.count}</span>
        </button>
      ))}
    </div>
  )
}
