import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Search, Settings, Plus } from 'lucide-react'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { CsvDownloadButton } from '@/components/CsvDownloadButton'
import { SqlInspector } from '@/components/SqlInspector'
import { PageLoading } from '@/components/LoadingSpinner'
import { TAManager } from '@/components/TAManager'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useTrialFilters, type FilterKey } from '@/hooks/useTrialFilters'
import { useTherapeuticAreaTree, taTreeQueries, type TANode } from '@/hooks/useTherapeuticAreaTree'
import { useTherapeuticAreaTerms, buildKeywordMap, conditionMatchesArea } from '@/hooks/useTherapeuticAreaTerms'
import { useFilterToggle } from '@/hooks/useFilterNav'
import { useClassificationRules, applyRules } from '@/hooks/useClassificationRules'
import { deduplicateConditions } from '@/lib/trial-utils'
import { cn, formatNumber } from '@/lib/utils'

export function TherapeuticAreasPage() {
  const { trials: filtered, isLoading: loadingTrials } = useFilteredTrials()
  const { filters } = useTrialFilters()
  const { data: tree, isLoading: loadingTree } = useTherapeuticAreaTree()
  const { data: taTermsData } = useTherapeuticAreaTerms()
  const taTerms = taTermsData?.terms
  const { data: rules } = useClassificationRules()
  const toggleFilter = useFilterToggle()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  /** null = closed, 'new' = creating, or a TA value string = editing that term */
  const [manageTarget, setManageTarget] = useState<string | null>(null)
  const managerRef = useRef<HTMLDivElement>(null)

  // Scroll the manager panel into view whenever it opens (or target changes)
  useEffect(() => {
    if (manageTarget && managerRef.current) {
      managerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [manageTarget])

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

  // When searching, filter the unclassified conditions list too
  const visibleUnclassifiedConditions = useMemo(() => {
    if (!search) return unclassifiedConditions
    const q = search.toLowerCase()
    return unclassifiedConditions.filter((c) => c.name.toLowerCase().includes(q))
  }, [unclassifiedConditions, search])

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

  // Build a searchable text index: term value -> array of lowercased strings
  // (value, label, aliases). Each string is tested with word-boundary matching
  // so typing "kidney" doesn't match unrelated substrings.
  const searchIndex = useMemo(() => {
    const map = new Map<string, string[]>()
    if (!taTerms) return map
    for (const term of taTerms) {
      const parts = [term.value, term.label, ...term.aliases]
        .map((s) => s.toLowerCase().replace(/_/g, ' '))
      map.set(term.value, parts)
    }
    return map
  }, [taTerms])

  const matchesSearch = (value: string) => {
    if (!search) return true
    const q = search.toLowerCase().trim()
    if (!q) return true
    // Word-boundary regex: matches "kidney" as a whole word, not inside "kidneyish"
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}`, 'i')
    const parts = searchIndex.get(value)
    if (parts) return parts.some((p) => re.test(p))
    return re.test(value.toLowerCase().replace(/_/g, ' '))
  }

  // If we have an ontology tree, render it; otherwise fall back to flat list.
  // Synthesize top-level nodes for any term that has no parent AND no children
  // (terms created via admin console with no is_a relationships).
  const roots = useMemo<TANode[] | null>(() => {
    if (!tree || tree.length === 0) return null
    if (!taTerms || taTerms.length === 0) return tree
    const inTree = new Set<string>()
    const walk = (n: TANode) => {
      inTree.add(n.value)
      n.children.forEach(walk)
    }
    tree.forEach(walk)
    const orphans: TANode[] = taTerms
      .filter((t) => !inTree.has(t.value))
      .map((t) => ({ value: t.value, label: t.label, children: [] }))
    // Merge orphans with tree roots and sort the whole set alphabetically by label
    return [...tree, ...orphans].sort((a, b) => a.label.localeCompare(b.label))
  }, [tree, taTerms])

  // Compute the set of values to show under the current search query:
  // a node is visible if it matches OR any of its descendants match.
  // `ancestorsOfMatch` is the subset of visible nodes that are only visible
  // because a descendant matched (not themselves) — those get auto-expanded
  // so the user can see the match.
  const { visibleUnderSearch, ancestorsOfMatch } = useMemo(() => {
    if (!search) return { visibleUnderSearch: null, ancestorsOfMatch: new Set<string>() }
    const visible = new Set<string>()
    const ancestors = new Set<string>()
    const walk = (node: TANode): boolean => {
      const selfMatch = matchesSearch(node.value)
      let childMatch = false
      for (const c of node.children) {
        if (walk(c)) childMatch = true
      }
      const any = selfMatch || childMatch
      if (any) {
        visible.add(node.value)
        if (childMatch && !selfMatch) ancestors.add(node.value)
      }
      return any
    }
    roots?.forEach(walk)
    return { visibleUnderSearch: visible, ancestorsOfMatch: ancestors }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, roots, searchIndex])

  if (loadingTrials || loadingTree) return <PageLoading message="Loading therapeutic areas..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Therapeutic Areas</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setManageTarget('new')}
            disabled={!taTermsData?.terminologyId}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-40"
            title="Create a new therapeutic area"
          >
            <Plus className="h-3.5 w-3.5" />
            New TA
          </button>
          <CsvDownloadButton
            getData={() => ({
              columns: ['Therapeutic Area', 'Trials', 'Conditions'],
              rows: flatAreas.map((a) => [
                a.area.replace(/_/g, ' '),
                String(a.trialCount),
                String(a.conditions.length),
              ]),
            })}
            filenamePrefix="therapeutic-areas"
          />
          <span className="text-sm text-text-muted">
            {flatAreas.length} areas · {taTerms?.length ?? 0} TAs · {formatNumber(filtered.length)} trials
          </span>
        </div>
      </div>

      <SqlInspector queries={taTreeQueries} />

      {/* TA manager panel */}
      {manageTarget && taTermsData?.terminologyId && (
        <div ref={managerRef}>
          <TAManager
            term={
              manageTarget === 'new'
                ? null
                : (taTerms?.find((t) => t.value === manageTarget) ?? null)
            }
            allTerms={taTerms ?? []}
            terminologyId={taTermsData.terminologyId}
            onClose={() => setManageTarget(null)}
          />
        </div>
      )}

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
              visibleUnderSearch={visibleUnderSearch}
              ancestorsOfMatch={ancestorsOfMatch}
              search={search}
              onManage={setManageTarget}
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

        {/* Unclassified — hidden entirely when searching yields zero matches */}
        {unclassified.length > 0 && (!search || visibleUnclassifiedConditions.length > 0) && (
          <Card className={cn('p-0 overflow-hidden border-dashed', selectedAreas.length > 0 && 'opacity-50')}>
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50/50"
              onClick={() => toggleExpand('__unclassified__')}
            >
              {expanded.has('__unclassified__') || !!search ? (
                <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0" />
              )}
              <span className="font-semibold text-sm text-text-muted">Unclassified</span>
              <Badge variant="muted">{formatNumber(unclassified.length)} trials</Badge>
              <Badge variant="muted">
                {search
                  ? `${visibleUnclassifiedConditions.length} of ${unclassifiedConditions.length} conditions`
                  : `${unclassifiedConditions.length} conditions`}
              </Badge>
            </div>
            {(expanded.has('__unclassified__') || !!search) && (
              <div className="border-t border-gray-100 bg-gray-50/30 px-4 py-3">
                <p className="mb-2 text-xs text-text-muted">
                  Trials with conditions that don't match any therapeutic area keyword.
                </p>
                <ConditionGrid
                  conditions={
                    expanded.has('__unclassified_all__') || !!search
                      ? visibleUnclassifiedConditions
                      : visibleUnclassifiedConditions.slice(0, 30)
                  }
                  selectedConditions={filters.condition ?? []}
                  toggleCondition={(c) => toggleFilter('condition', c)}
                />
                {!search && unclassifiedConditions.length > 30 && (
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
  visibleUnderSearch,
  ancestorsOfMatch,
  search,
  onManage,
}: {
  node: TANode
  depth: number
  areaStats: Map<string, { trials: Set<string>; conditions: Map<string, number> }>
  selectedAreas: string[]
  expanded: Set<string>
  toggleExpand: (area: string) => void
  toggleFilter: (key: FilterKey, value: string) => void
  /** Set of node values to show under the current search; null = no search active */
  visibleUnderSearch: Set<string> | null
  /** Nodes visible only because a descendant matched — auto-expand these */
  ancestorsOfMatch: Set<string>
  search: string
  onManage: (value: string) => void
}) {
  const stats = areaStats.get(node.value)
  const trialCount = stats?.trials.size ?? 0
  const conditions = stats
    ? deduplicateConditions([...stats.conditions.entries()].map(([name, count]) => ({ name, count }))).sort((a, b) => a.name.localeCompare(b.name))
    : []

  // When searching, only show conditions whose name contains the search term
  const visibleConditions = useMemo(() => {
    if (!search) return conditions
    const q = search.toLowerCase()
    return conditions.filter((c) => c.name.toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conditions, search])

  // Include children's trial counts for parent display
  const childTrialCount = node.children.reduce((sum, child) => {
    const cs = areaStats.get(child.value)
    return sum + (cs?.trials.size ?? 0)
  }, 0)

  const totalTrials = trialCount + childTrialCount
  const isSelected = selectedAreas.includes(node.value)
  const isDimmed = selectedAreas.length > 0 && !isSelected && !node.children.some((c) => selectedAreas.includes(c.value))
  // Auto-expand ancestors of a match so the matching descendant is visible.
  // Do NOT auto-expand the matching node itself — the user wants to see IT,
  // not be drowned in its children.
  const isExpanded = expanded.has(node.value) || ancestorsOfMatch.has(node.value)
  const hasChildren = node.children.length > 0

  // Skip if doesn't match search (search set pre-computed by parent with deep matching)
  if (search && visibleUnderSearch && !visibleUnderSearch.has(node.value)) {
    return null
  }

  // Skip 0-trial nodes, but always show top-level roots (so orphan TAs stay
  // visible for management) and always show nodes when searching.
  if (totalTrials === 0 && !search && depth > 0) return null

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
          <button
            onClick={(e) => {
              e.stopPropagation()
              onManage(node.value)
            }}
            className="rounded-md p-1 text-text-muted hover:bg-gray-100 hover:text-primary"
            title={`Manage ${node.label}`}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Expanded: show conditions with show-all toggle */}
        {isExpanded && visibleConditions.length > 0 && (
          <ExpandableConditions
            conditions={visibleConditions}
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
          visibleUnderSearch={visibleUnderSearch}
          ancestorsOfMatch={ancestorsOfMatch}
          search={search}
          onManage={onManage}
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
