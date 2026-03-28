import { useMemo, useState } from 'react'
import { Search, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { useAEFrequency, useAEGrouped, useOrganSystems } from '@/hooks/useAEAnalytics'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/utils'

type Category = 'ALL' | 'SERIOUS' | 'OTHER'
type GroupBy = 'none' | 'molecule' | 'therapeutic_area'
type SortKey = 'term' | 'organ_system' | 'trial_count' | 'report_count'

export function AdverseEventsPage() {
  const [category, setCategory] = useState<Category>('ALL')
  const [groupBy, setGroupBy] = useState<GroupBy>('none')
  const [search, setSearch] = useState('')
  const [organFilter, setOrganFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('trial_count')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedTerms, setExpandedTerms] = useState<Set<string>>(new Set())

  const organSystems = useOrganSystems()
  const { data: flatData, isLoading: loadingFlat, trialCount } = useAEFrequency(category)
  const { data: groupedData, isLoading: loadingGrouped } = useAEGrouped(groupBy, category)

  const isLoading = groupBy === 'none' ? loadingFlat : loadingGrouped

  // Filter and sort flat data
  const filteredFlat = useMemo(() => {
    let rows = flatData
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter((r) => r.term.toLowerCase().includes(q) || r.organ_system?.toLowerCase().includes(q))
    }
    if (organFilter) {
      rows = rows.filter((r) => r.organ_system === organFilter)
    }
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      const cmp = typeof av === 'number' ? av - (bv as number) : String(av).localeCompare(String(bv))
      return sortAsc ? cmp : -cmp
    })
  }, [flatData, search, organFilter, sortKey, sortAsc])

  // Build grouped comparison matrix
  const comparisonData = useMemo(() => {
    if (groupBy === 'none' || groupedData.length === 0) return null

    // Get unique entities (molecules or TAs)
    const entities = [...new Set(groupedData.map((r) => r.entity))].sort()
    // Get top terms across all entities
    const termCounts = new Map<string, number>()
    for (const r of groupedData) {
      termCounts.set(r.term, (termCounts.get(r.term) || 0) + r.trial_count)
    }
    let terms = [...termCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)

    if (search) {
      const q = search.toLowerCase()
      terms = terms.filter((t) => t.toLowerCase().includes(q))
    }
    terms = terms.slice(0, 40)

    // Build lookup: term → entity → trial_count
    const matrix = new Map<string, Map<string, number>>()
    for (const r of groupedData) {
      if (!terms.includes(r.term)) continue
      if (!matrix.has(r.term)) matrix.set(r.term, new Map())
      const existing = matrix.get(r.term)!.get(r.entity) || 0
      matrix.get(r.term)!.set(r.entity, existing + r.trial_count)
    }

    // Find max for color scaling
    let maxCount = 0
    for (const row of matrix.values()) {
      for (const v of row.values()) {
        if (v > maxCount) maxCount = v
      }
    }

    return { entities, terms, matrix, maxCount }
  }, [groupedData, groupBy, search])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  function toggleExpand(term: string) {
    setExpandedTerms((prev) => {
      const next = new Set(prev)
      if (next.has(term)) next.delete(term)
      else next.add(term)
      return next
    })
  }

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    const active = sortKey === field
    return (
      <th
        className={cn('pb-2 pr-4 cursor-pointer select-none', field === 'trial_count' || field === 'report_count' ? 'text-right' : 'text-left')}
        onClick={() => toggleSort(field)}
      >
        <span className={cn(active && 'text-primary')}>
          {label} {active ? (sortAsc ? '↑' : '↓') : ''}
        </span>
      </th>
    )
  }

  if (isLoading) return <PageLoading message="Loading adverse events..." />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-danger" />
          <h1 className="text-2xl font-bold">Adverse Events</h1>
        </div>
        <span className="text-sm text-text-muted">
          Across {formatNumber(trialCount)} trials
        </span>
      </div>

      {/* Controls */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          {/* Category */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Category:</span>
            {(['ALL', 'SERIOUS', 'OTHER'] as Category[]).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  category === c
                    ? c === 'SERIOUS' ? 'bg-danger text-white' : 'bg-primary text-white'
                    : 'bg-gray-100 text-text-muted hover:bg-gray-200',
                )}
              >
                {c === 'ALL' ? 'All' : c === 'SERIOUS' ? 'Serious' : 'Other'}
              </button>
            ))}
          </div>

          {/* Group by */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Group by:</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="rounded-md border border-gray-300 bg-surface px-2 py-1 text-xs focus:border-primary focus:outline-none"
            >
              <option value="none">None (flat list)</option>
              <option value="molecule">Molecule</option>
              <option value="therapeutic_area">Therapeutic Area</option>
            </select>
          </div>

          {/* Organ system filter (flat mode only) */}
          {groupBy === 'none' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">Organ system:</span>
              <select
                value={organFilter}
                onChange={(e) => setOrganFilter(e.target.value)}
                className="max-w-[200px] rounded-md border border-gray-300 bg-surface px-2 py-1 text-xs focus:border-primary focus:outline-none"
              >
                <option value="">All</option>
                {organSystems.map((os) => (
                  <option key={os} value={os}>{os}</option>
                ))}
              </select>
            </div>
          )}

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search AE terms..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-surface py-1 pl-8 pr-3 text-xs focus:border-primary focus:outline-none"
            />
          </div>
        </div>
      </Card>

      {/* Results */}
      {groupBy === 'none' ? (
        /* Flat frequency table */
        <Card>
          <CardHeader>
            <CardTitle>
              AE Frequency ({formatNumber(filteredFlat.length)} terms)
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-text-muted">
                  <th className="w-6 pb-2" />
                  <SortHeader label="Term" field="term" />
                  <SortHeader label="Organ System" field="organ_system" />
                  <SortHeader label="Trials" field="trial_count" />
                  <SortHeader label="Reports" field="report_count" />
                </tr>
              </thead>
              <tbody>
                {filteredFlat.slice(0, 200).map((ae) => {
                  const key = `${ae.term}|${ae.organ_system}|${ae.ae_category}`
                  const expanded = expandedTerms.has(key)
                  return (
                    <tr
                      key={key}
                      className={cn(
                        'border-b border-gray-50 cursor-pointer hover:bg-gray-50',
                        expanded && 'bg-blue-50/50',
                      )}
                      onClick={() => toggleExpand(key)}
                    >
                      <td className="py-1.5 w-6">
                        {expanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
                          : <ChevronRight className="h-3.5 w-3.5 text-text-muted" />}
                      </td>
                      <td className="py-1.5 pr-4 font-medium">{ae.term}</td>
                      <td className="py-1.5 pr-4 text-text-muted">{ae.organ_system}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{formatNumber(ae.trial_count)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatNumber(ae.report_count)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {filteredFlat.length > 200 && (
            <p className="mt-2 text-center text-xs text-text-muted">
              Showing 200 of {formatNumber(filteredFlat.length)} terms
            </p>
          )}
        </Card>
      ) : (
        /* Comparison matrix */
        comparisonData && comparisonData.terms.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>
                AE Comparison by {groupBy === 'molecule' ? 'Molecule' : 'Therapeutic Area'}
                {' '}({comparisonData.entities.length} {groupBy === 'molecule' ? 'molecules' : 'areas'}, {comparisonData.terms.length} terms)
              </CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-text-muted">
                    <th className="pb-2 pr-3 text-left sticky left-0 bg-surface min-w-[180px]">AE Term</th>
                    {comparisonData.entities.map((e) => (
                      <th key={e} className="pb-2 px-2 text-center min-w-[80px]">
                        <span className="block truncate max-w-[100px]" title={e.replace(/_/g, ' ')}>
                          {e.replace(/_/g, ' ')}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparisonData.terms.map((term) => (
                    <tr key={term} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-1.5 pr-3 font-medium sticky left-0 bg-surface">{term}</td>
                      {comparisonData.entities.map((entity) => {
                        const count = comparisonData.matrix.get(term)?.get(entity) ?? 0
                        const intensity = comparisonData.maxCount > 0 ? count / comparisonData.maxCount : 0
                        return (
                          <td
                            key={entity}
                            className="py-1.5 px-2 text-center tabular-nums"
                            style={count > 0 ? {
                              backgroundColor: `rgba(220, 53, 69, ${0.08 + intensity * 0.35})`,
                            } : undefined}
                          >
                            {count > 0 ? count : <span className="text-gray-300">-</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="py-12 text-center text-text-muted">
              No AE data available for the current filters and grouping.
            </p>
          </Card>
        )
      )}

      {/* Summary stats */}
      {flatData.length > 0 && groupBy === 'none' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-lg font-bold">{formatNumber(flatData.length)}</p>
            <p className="text-xs text-text-muted">Unique AE Terms</p>
          </Card>
          <Card>
            <p className="text-lg font-bold">
              {formatNumber(new Set(flatData.map((r) => r.organ_system)).size)}
            </p>
            <p className="text-xs text-text-muted">Organ Systems</p>
          </Card>
          <Card>
            <p className="text-lg font-bold">
              {formatNumber(flatData.reduce((s, r) => s + r.report_count, 0))}
            </p>
            <p className="text-xs text-text-muted">Total Reports</p>
          </Card>
        </div>
      )}
    </div>
  )
}
