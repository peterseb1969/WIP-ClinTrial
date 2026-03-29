import { useMemo, useState } from 'react'
import { Search, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  LineChart, Line,
} from 'recharts'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { CsvDownloadButton } from '@/components/CsvDownloadButton'
import { SqlInspector } from '@/components/SqlInspector'
import { AEDrillDownPanel } from '@/components/AEDrillDownPanel'
import { AETermManager } from '@/components/AETermManager'
import { PageLoading } from '@/components/LoadingSpinner'
import {
  useAEFrequency, useAEGrouped, useAEByCombination, useOrganSystems,
  useAESeverityDistribution, useAETemporal,
  type AERow,
} from '@/hooks/useAEAnalytics'
import { useAETermResolution, mergeResolvedRows, type ResolvedTerm } from '@/hooks/useAETermResolution'
import { useTrialFilters } from '@/hooks/useTrialFilters'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/utils'

type Category = 'ALL' | 'SERIOUS' | 'OTHER'
type GroupBy = 'none' | 'molecule' | 'therapeutic_area'
type ViewMode = 'flat' | 'organ_system' | 'grouped'
type SortKey = 'term' | 'organ_system' | 'trial_count' | 'report_count' | 'incidence_pct'
const AE_PAGE_SIZE = 200
const LINE_COLORS = ['#2B579A', '#DC3545', '#2E8B57', '#ED7D31', '#7C4DFF', '#00BCD4', '#FF9800', '#E91E63', '#795548', '#607D8B']

export function AdverseEventsPage() {
  const { filters } = useTrialFilters()
  const [category, setCategory] = useState<Category>('ALL')
  const [groupBy, setGroupBy] = useState<GroupBy>('molecule')
  const [viewMode, setViewMode] = useState<ViewMode>('flat')
  const [search, setSearch] = useState('')
  const [organFilter, setOrganFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('trial_count')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedTerms, setExpandedTerms] = useState<Set<string>>(new Set())
  const [expandedOrgans, setExpandedOrgans] = useState<Set<string>>(new Set())
  const [showAllAEs, setShowAllAEs] = useState(false)

  // Comparison column view toggles
  const [showPooled, setShowPooled] = useState(true)
  const [showCombinations, setShowCombinations] = useState(false)
  const [showMonotherapy, setShowMonotherapy] = useState(false)

  const [managingTerm, setManagingTerm] = useState<string | null>(null)

  const { data: organSystems, queries: organQueries } = useOrganSystems()
  const { data: rawFlatData, isLoading: loadingFlat, trialCount, nctIds, queries: freqQueries } = useAEFrequency(category)
  const { resolve, terminologyId, termCount: resolvedTermCount } = useAETermResolution()

  // Apply term resolution: merge rows that resolve to the same canonical term
  const flatData = useMemo(() => {
    if (!rawFlatData.length) return rawFlatData
    return mergeResolvedRows(rawFlatData, resolve)
  }, [rawFlatData, resolve])

  // All unique raw term strings (pre-merge, deduplicated) for suggestions/typeahead
  const allRawTerms = useMemo(() => [...new Set(rawFlatData.map((r) => r.term))], [rawFlatData])
  const { data: groupedData, isLoading: loadingGrouped, queries: groupedQueries } = useAEGrouped(
    viewMode === 'grouped' ? groupBy : 'none', category,
  )
  const { data: comboData, isLoading: loadingCombos, queries: comboQueries } = useAEByCombination(category)
  const { data: severityData, queries: severityQueries } = useAESeverityDistribution()
  const { data: temporalData, queries: temporalQueries } = useAETemporal()

  const isLoading = viewMode === 'grouped' ? loadingGrouped : loadingFlat

  // Derive effective groupBy from viewMode
  const effectiveGroupBy = viewMode === 'grouped' ? groupBy : 'none'

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

  // Group by organ system for accordion view
  const organGroups = useMemo(() => {
    if (viewMode !== 'organ_system') return []
    const groups = new Map<string, AERow[]>()
    for (const row of filteredFlat) {
      const organ = row.organ_system || 'Unknown'
      if (!groups.has(organ)) groups.set(organ, [])
      groups.get(organ)!.push(row)
    }
    return [...groups.entries()]
      .map(([organ, rows]) => ({
        organ,
        rows,
        termCount: rows.length,
        totalReports: rows.reduce((s, r) => s + r.report_count, 0),
        maxIncidence: Math.max(...rows.map((r) => r.incidence_pct)),
      }))
      .sort((a, b) => b.totalReports - a.totalReports)
  }, [filteredFlat, viewMode])

  // Build comparison columns from three views: pooled, combinations, monotherapy
  const comparisonData = useMemo(() => {
    if (viewMode !== 'grouped') return null
    if (!showPooled && !showCombinations && !showMonotherapy) return null

    const activeFilter = groupBy === 'molecule' ? filters.molecule : filters.therapeutic_area
    const selectedEntities = activeFilter && activeFilter.length > 0 ? activeFilter : []

    // Column definition: { key, label, group }
    type Column = { key: string; label: string; group: 'Pooled' | 'Combinations' | 'Monotherapy' }
    const columns: Column[] = []

    // Per-column data: columnKey → term → trial_count
    const colData = new Map<string, Map<string, number>>()

    // --- Pooled view: one column per selected entity (all trials containing it) ---
    if (showPooled && groupedData.length > 0) {
      const pooledEntities = selectedEntities.length > 0
        ? selectedEntities
        : [...new Set(groupedData.map((r) => r.entity))].sort()

      for (const entity of pooledEntities) {
        const key = `pooled:${entity}`
        columns.push({ key, label: entity.replace(/_/g, ' '), group: 'Pooled' })
        const termMap = new Map<string, number>()
        for (const r of groupedData) {
          if (r.entity === entity) {
            termMap.set(r.term, (termMap.get(r.term) || 0) + r.trial_count)
          }
        }
        colData.set(key, termMap)
      }
    }

    // --- Combination + Monotherapy views: built from comboData ---
    if ((showCombinations || showMonotherapy) && comboData.length > 0) {
      // Parse each combo_key (JSON array string) into sorted molecule list
      const parsedCombos = new Map<string, string[]>()
      for (const r of comboData) {
        if (!parsedCombos.has(r.combo_key)) {
          try {
            const arr = JSON.parse(r.combo_key) as string[]
            parsedCombos.set(r.combo_key, arr.sort())
          } catch {
            parsedCombos.set(r.combo_key, [r.combo_key])
          }
        }
      }

      // Filter combos to those containing at least one selected entity
      const relevantCombos = new Map<string, string[]>()
      for (const [comboKey, mols] of parsedCombos) {
        if (selectedEntities.length === 0 || mols.some((m) => selectedEntities.includes(m))) {
          relevantCombos.set(comboKey, mols)
        }
      }

      if (showMonotherapy) {
        // Mono: combos with exactly 1 entity, which is in selectedEntities
        for (const [comboKey, mols] of relevantCombos) {
          if (mols.length === 1 && (selectedEntities.length === 0 || selectedEntities.includes(mols[0]))) {
            const key = `mono:${comboKey}`
            columns.push({ key, label: `${mols[0].replace(/_/g, ' ')} (mono)`, group: 'Monotherapy' })
            const termMap = new Map<string, number>()
            for (const r of comboData) {
              if (r.combo_key === comboKey) {
                termMap.set(r.term, (termMap.get(r.term) || 0) + r.trial_count)
              }
            }
            colData.set(key, termMap)
          }
        }
      }

      if (showCombinations) {
        // Combination: combos with 2+ entities
        for (const [comboKey, mols] of relevantCombos) {
          if (mols.length >= 2) {
            const key = `combo:${comboKey}`
            const label = mols.map((m) => m.replace(/_/g, ' ')).join(' + ')
            columns.push({ key, label, group: 'Combinations' })
            const termMap = new Map<string, number>()
            for (const r of comboData) {
              if (r.combo_key === comboKey) {
                termMap.set(r.term, (termMap.get(r.term) || 0) + r.trial_count)
              }
            }
            colData.set(key, termMap)
          }
        }
      }
    }

    if (columns.length === 0) return null

    // Build term ranking from all visible columns
    const termCounts = new Map<string, number>()
    for (const termMap of colData.values()) {
      for (const [term, count] of termMap) {
        termCounts.set(term, (termCounts.get(term) || 0) + count)
      }
    }
    let terms = [...termCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)

    if (search) {
      const q = search.toLowerCase()
      terms = terms.filter((t) => t.toLowerCase().includes(q))
    }
    terms = terms.slice(0, 40)

    // Build matrix: term → columnKey → count
    const matrix = new Map<string, Map<string, number>>()
    for (const term of terms) {
      const row = new Map<string, number>()
      for (const col of columns) {
        row.set(col.key, colData.get(col.key)?.get(term) ?? 0)
      }
      matrix.set(term, row)
    }

    let maxCount = 0
    for (const row of matrix.values()) {
      for (const v of row.values()) {
        if (v > maxCount) maxCount = v
      }
    }

    // Group columns by their view group for header rendering
    const columnGroups = new Map<string, Column[]>()
    for (const col of columns) {
      if (!columnGroups.has(col.group)) columnGroups.set(col.group, [])
      columnGroups.get(col.group)!.push(col)
    }

    return { columns, columnGroups, terms, matrix, maxCount }
  }, [viewMode, groupedData, comboData, search, groupBy, filters.molecule, filters.therapeutic_area,
      showPooled, showCombinations, showMonotherapy])

  // All SQL queries for the inspector
  const allQueries = useMemo(() => [
    ...freqQueries,
    ...(effectiveGroupBy !== 'none' ? groupedQueries : []),
    ...(viewMode === 'grouped' && (showCombinations || showMonotherapy) ? comboQueries : []),
    ...organQueries,
    ...severityQueries,
    ...temporalQueries,
  ], [freqQueries, groupedQueries, comboQueries, organQueries, severityQueries, temporalQueries,
      effectiveGroupBy, viewMode, showCombinations, showMonotherapy])

  // Temporal chart data: pivot into {year, term1, term2, ...}
  const temporalChartData = useMemo(() => {
    if (temporalData.length === 0) return { data: [], terms: [] }
    // Get top 10 terms by total count
    const termTotals = new Map<string, number>()
    for (const r of temporalData) {
      termTotals.set(r.term, (termTotals.get(r.term) || 0) + r.trial_count)
    }
    const topTerms = [...termTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t)

    // Pivot: year → {year, term1: count, term2: count, ...}
    const byYear = new Map<string, Record<string, unknown>>()
    for (const r of temporalData) {
      if (!topTerms.includes(r.term)) continue
      if (!byYear.has(r.year)) byYear.set(r.year, { year: r.year })
      byYear.get(r.year)![r.term] = r.trial_count
    }
    return {
      data: [...byYear.values()].sort((a, b) => String(a.year).localeCompare(String(b.year))),
      terms: topTerms,
    }
  }, [temporalData])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  function toggleExpand(term: string) {
    setExpandedTerms((prev) => {
      const next = new Set(prev)
      if (next.has(term)) next.delete(term); else next.add(term)
      return next
    })
  }

  function toggleOrgan(organ: string) {
    setExpandedOrgans((prev) => {
      const next = new Set(prev)
      if (next.has(organ)) next.delete(organ); else next.add(organ)
      return next
    })
  }

  function SortHeader({ label, field, align }: { label: string; field: SortKey; align?: 'right' }) {
    const active = sortKey === field
    return (
      <th
        className={cn('pb-2 pr-4 cursor-pointer select-none', align === 'right' && 'text-right')}
        onClick={() => toggleSort(field)}
      >
        <span className={cn(active && 'text-primary')}>
          {label} {active ? (sortAsc ? '↑' : '↓') : ''}
        </span>
      </th>
    )
  }

  const getCsvData = () => {
    // Comparison view: export matrix with all visible columns
    if (viewMode === 'grouped' && comparisonData && comparisonData.terms.length > 0) {
      const columns = ['AE Term', ...comparisonData.columns.map((c) => `${c.label} [${c.group}]`)]
      const rows = comparisonData.terms.map((term) =>
        [term, ...comparisonData.columns.map((col) => String(comparisonData.matrix.get(term)?.get(col.key) ?? 0))]
      )
      return { columns, rows }
    }
    // Flat / organ system view: export the filtered flat table
    return {
      columns: ['Term', 'Organ System', 'Category', 'Trials', 'Reports', 'Affected', 'At Risk', 'Incidence %'],
      rows: filteredFlat.map((r) => [
        r.term, r.organ_system, r.ae_category,
        String(r.trial_count), String(r.report_count),
        String(r.total_affected), String(r.total_at_risk),
        r.incidence_pct.toFixed(1),
      ]),
    }
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
        <div className="flex items-center gap-3">
          <CsvDownloadButton getData={getCsvData} filenamePrefix="adverse-events" />
          <span className="text-sm text-text-muted">
            Across {formatNumber(trialCount)} trials
            {resolvedTermCount > 0 && (
              <> · {formatNumber(resolvedTermCount)} normalized terms</>
            )}
          </span>
        </div>
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

          {/* View mode */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">View:</span>
            {([
              { value: 'flat' as ViewMode, label: 'Flat List' },
              { value: 'organ_system' as ViewMode, label: 'By Organ System' },
              { value: 'grouped' as ViewMode, label: 'Comparison' },
            ]).map((v) => (
              <button
                key={v.value}
                onClick={() => setViewMode(v.value)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  viewMode === v.value
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-text-muted hover:bg-gray-200',
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Group by (comparison mode) */}
          {viewMode === 'grouped' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Group by:</span>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                  className="rounded-md border border-gray-300 bg-surface px-2 py-1 text-xs focus:border-primary focus:outline-none"
                >
                  <option value="molecule">Molecule</option>
                  <option value="therapeutic_area">Therapeutic Area</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">Show:</span>
                <ViewToggle label="Pooled" active={showPooled} onClick={() => setShowPooled(!showPooled)} />
                <ViewToggle label="Combinations" active={showCombinations} onClick={() => setShowCombinations(!showCombinations)} />
                <ViewToggle label="Monotherapy" active={showMonotherapy} onClick={() => setShowMonotherapy(!showMonotherapy)} />
              </div>
            </>
          )}

          {/* Organ system filter (flat mode only) */}
          {viewMode === 'flat' && (
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
        <SqlInspector queries={allQueries} />
      </Card>

      {/* Results */}
      {viewMode === 'flat' ? (
        <FlatTable
          rows={filteredFlat}
          showAll={showAllAEs}
          onToggleShowAll={() => setShowAllAEs(!showAllAEs)}
          expandedTerms={expandedTerms}
          onToggleExpand={toggleExpand}
          nctIds={nctIds}
          SortHeader={SortHeader}
          resolve={resolve}
          terminologyId={terminologyId}
          managingTerm={managingTerm}
          onManage={setManagingTerm}
          allRawTerms={allRawTerms}
        />
      ) : viewMode === 'organ_system' ? (
        <OrganAccordion
          groups={organGroups}
          expandedOrgans={expandedOrgans}
          onToggleOrgan={toggleOrgan}
          expandedTerms={expandedTerms}
          onToggleExpand={toggleExpand}
          nctIds={nctIds}
          resolve={resolve}
          onManage={setManagingTerm}
          managingTerm={managingTerm}
          terminologyId={terminologyId}
          allRawTerms={allRawTerms}
        />
      ) : (
        (loadingGrouped || loadingCombos) ? (
          <PageLoading message="Loading comparison data..." />
        ) : comparisonData && comparisonData.terms.length > 0 ? (
          <ComparisonMatrix data={comparisonData} />
        ) : (
          <Card>
            <div className="py-12 text-center">
              <p className="text-text-muted">
                {!showPooled && !showCombinations && !showMonotherapy
                  ? 'Enable at least one column view (Pooled, Combinations, or Monotherapy).'
                  : trialCount === 0
                    ? 'No trials match the current filters.'
                    : flatData.length === 0
                      ? 'No adverse event data reported for the filtered trials.'
                      : `No AE data could be grouped by ${groupBy === 'molecule' ? 'molecule' : 'therapeutic area'}. The filtered trials may not have ${groupBy === 'molecule' ? 'interventions' : 'therapeutic areas'} assigned.`}
              </p>
              {flatData.length > 0 && (
                <p className="mt-2 text-xs text-text-muted">
                  There are {formatNumber(flatData.length)} AE terms in the flat view.
                  Try switching to "Flat List" to see them.
                </p>
              )}
            </div>
          </Card>
        )
      )}

      {/* Visualizations: Severity + Temporal */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Severity distribution */}
        {severityData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Severity Distribution (Top 30)</CardTitle>
            </CardHeader>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={severityData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="term" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="serious_count" name="Serious" fill="#DC3545" stackId="a" />
                  <Bar dataKey="other_count" name="Other" fill="#5B9BD5" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        {/* Temporal view */}
        {temporalChartData.data.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>AE Terms Over Time (by Trial Start Year)</CardTitle>
            </CardHeader>
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={temporalChartData.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {temporalChartData.terms.map((term, i) => (
                    <Line
                      key={term}
                      type="monotone"
                      dataKey={term}
                      stroke={LINE_COLORS[i % LINE_COLORS.length]}
                      strokeWidth={1.5}
                      dot={{ r: 2 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {temporalChartData.data.length < 3 && (
              <p className="mt-2 text-xs text-text-muted">
                Limited year coverage — chart may be sparse.
              </p>
            )}
          </Card>
        )}
      </div>

      {/* Summary stats */}
      {flatData.length > 0 && viewMode !== 'grouped' && (
        <div className="grid gap-4 sm:grid-cols-4">
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
          <Card>
            <p className="text-lg font-bold">
              {formatNumber(flatData.reduce((s, r) => s + r.total_affected, 0))}
            </p>
            <p className="text-xs text-text-muted">Total Affected</p>
          </Card>
        </div>
      )}
    </div>
  )
}

/** Flat frequency table with drill-down and incidence columns */
function FlatTable({
  rows, showAll, onToggleShowAll, expandedTerms, onToggleExpand, nctIds, SortHeader,
  resolve, terminologyId, managingTerm, onManage, allRawTerms,
}: {
  rows: AERow[]
  showAll: boolean
  onToggleShowAll: () => void
  expandedTerms: Set<string>
  onToggleExpand: (key: string) => void
  nctIds: string[]
  SortHeader: React.FC<{ label: string; field: SortKey; align?: 'right' }>
  resolve: (raw: string) => ResolvedTerm | null
  terminologyId: string | null
  managingTerm: string | null
  onManage: (term: string | null) => void
  allRawTerms: string[]
}) {
  const displayed = showAll ? rows : rows.slice(0, AE_PAGE_SIZE)

  return (
    <Card>
      <CardHeader>
        <CardTitle>AE Frequency ({formatNumber(rows.length)} terms)</CardTitle>
      </CardHeader>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-text-muted">
              <th className="w-6 pb-2" />
              <SortHeader label="Term" field="term" />
              <SortHeader label="Organ System" field="organ_system" />
              <SortHeader label="Trials" field="trial_count" align="right" />
              <SortHeader label="Reports" field="report_count" align="right" />
              <SortHeader label="Incidence" field="incidence_pct" align="right" />
            </tr>
          </thead>
          <tbody>
            {displayed.map((ae) => {
              const key = `${ae.term}|${ae.organ_system}|${ae.ae_category}`
              const expanded = expandedTerms.has(key)
              const resolved = resolve(ae.term)
              return (
                <AERowWithDrillDown
                  key={key}
                  ae={ae}
                  rowKey={key}
                  expanded={expanded}
                  onToggle={() => onToggleExpand(key)}
                  nctIds={nctIds}
                  resolved={resolved}
                  onManage={onManage}
                  managing={managingTerm === ae.term}
                  terminologyId={terminologyId}
                  onCloseManage={() => onManage(null)}
                  allRawTerms={allRawTerms}
                  resolve={resolve}
                />
              )
            })}
          </tbody>
        </table>
      </div>
      {rows.length > AE_PAGE_SIZE && (
        <button
          onClick={onToggleShowAll}
          className="mt-2 w-full text-center text-xs font-medium text-primary hover:underline"
        >
          {showAll ? 'Show less' : `Show all ${formatNumber(rows.length)} terms`}
        </button>
      )}
    </Card>
  )
}

/** Single AE row + expandable drill-down */
function AERowWithDrillDown({
  ae, expanded, onToggle, nctIds, resolved, onManage, managing, terminologyId, onCloseManage,
  allRawTerms, resolve,
}: {
  ae: AERow; rowKey: string; expanded: boolean; onToggle: () => void; nctIds: string[]
  resolved: ResolvedTerm | null
  onManage: (term: string) => void
  managing: boolean
  terminologyId: string | null
  onCloseManage: () => void
  allRawTerms: string[]
  resolve: (raw: string) => ResolvedTerm | null
}) {
  return (
    <>
      <tr
        className={cn(
          'group border-b border-gray-50 cursor-pointer hover:bg-gray-50',
          expanded && 'bg-blue-50/50',
          managing && 'bg-primary/5',
        )}
        onClick={onToggle}
      >
        <td className="py-1.5 w-6">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
            : <ChevronRight className="h-3.5 w-3.5 text-text-muted" />}
        </td>
        <td className="py-1.5 pr-4">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{ae.term}</span>
            {resolved && resolved.aliases.length > 0 && (
              <span className="text-[10px] text-primary bg-primary/10 rounded-full px-1.5">
                +{resolved.aliases.length}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); managing ? onCloseManage() : onManage(ae.term) }}
              className={cn(
                'text-text-muted hover:text-primary ml-1',
                managing ? 'text-primary' : 'opacity-0 group-hover:opacity-100',
              )}
              title="Manage term"
            >
              <Search className="h-3 w-3" />
            </button>
          </div>
        </td>
        <td className="py-1.5 pr-4 text-text-muted">{ae.organ_system}</td>
        <td className="py-1.5 pr-4 text-right tabular-nums">{formatNumber(ae.trial_count)}</td>
        <td className="py-1.5 pr-4 text-right tabular-nums">{formatNumber(ae.report_count)}</td>
        <td className="py-1.5 text-right tabular-nums">
          <div className="flex items-center justify-end gap-2">
            <div className="h-1.5 w-16 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full',
                  ae.incidence_pct > 20 ? 'bg-danger' : ae.incidence_pct > 5 ? 'bg-accent' : 'bg-primary',
                )}
                style={{ width: `${Math.min(ae.incidence_pct, 100)}%` }}
              />
            </div>
            <span className={ae.incidence_pct > 20 ? 'text-danger font-medium' : ''}>
              {ae.incidence_pct.toFixed(1)}%
            </span>
          </div>
        </td>
      </tr>
      {managing && terminologyId && (
        <tr>
          <td colSpan={6} className="p-2">
            <AETermManager
              term={ae.term}
              termId={resolved?.termId ?? null}
              terminologyId={terminologyId}
              aliases={resolved?.aliases ?? []}
              allRawTerms={allRawTerms}
              resolve={resolve}
              onClose={onCloseManage}
            />
          </td>
        </tr>
      )}
      {expanded && (
        <AEDrillDownPanel term={ae.term} aeCategory={ae.ae_category} nctIds={nctIds} />
      )}
    </>
  )
}

/** Organ system accordion view */
function OrganAccordion({
  groups, expandedOrgans, onToggleOrgan, expandedTerms, onToggleExpand, nctIds,
  resolve, onManage, managingTerm, terminologyId, allRawTerms,
}: {
  groups: Array<{ organ: string; rows: AERow[]; termCount: number; totalReports: number; maxIncidence: number }>
  expandedOrgans: Set<string>
  onToggleOrgan: (organ: string) => void
  expandedTerms: Set<string>
  onToggleExpand: (key: string) => void
  nctIds: string[]
  resolve: (raw: string) => ResolvedTerm | null
  onManage: (term: string | null) => void
  managingTerm: string | null
  terminologyId: string | null
  allRawTerms: string[]
}) {
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const expanded = expandedOrgans.has(g.organ)
        return (
          <Card key={g.organ} className="p-0 overflow-hidden">
            <button
              onClick={() => onToggleOrgan(g.organ)}
              className="flex w-full items-center justify-between px-4 py-3 hover:bg-gray-50"
            >
              <div className="flex items-center gap-3">
                {expanded
                  ? <ChevronDown className="h-4 w-4 text-text-muted" />
                  : <ChevronRight className="h-4 w-4 text-text-muted" />}
                <span className="font-semibold">{g.organ}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span>{g.termCount} terms</span>
                <span>{formatNumber(g.totalReports)} reports</span>
                {g.maxIncidence > 0 && (
                  <span className={g.maxIncidence > 20 ? 'text-danger font-medium' : ''}>
                    max {g.maxIncidence.toFixed(1)}%
                  </span>
                )}
              </div>
            </button>
            {expanded && (
              <div className="border-t px-4 pb-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs text-text-muted">
                      <th className="w-6 pb-2" />
                      <th className="pb-2 pr-4 text-left">Term</th>
                      <th className="pb-2 pr-4 text-right">Trials</th>
                      <th className="pb-2 pr-4 text-right">Reports</th>
                      <th className="pb-2 text-right">Incidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((ae) => {
                      const key = `${ae.term}|${ae.organ_system}|${ae.ae_category}`
                      const termExpanded = expandedTerms.has(key)
                      return (
                        <AERowWithDrillDown
                          key={key}
                          ae={{ ...ae, organ_system: '' }}
                          rowKey={key}
                          expanded={termExpanded}
                          onToggle={() => onToggleExpand(key)}
                          nctIds={nctIds}
                          resolved={resolve(ae.term)}
                          onManage={onManage}
                          managing={managingTerm === ae.term}
                          terminologyId={terminologyId}
                          onCloseManage={() => onManage(null)}
                          allRawTerms={allRawTerms}
                          resolve={resolve}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

/** Comparison heatmap matrix */
type ComparisonColumn = { key: string; label: string; group: string }

const GROUP_COLORS: Record<string, string> = {
  Pooled: 'rgba(43, 87, 154, 0.08)',
  Combinations: 'rgba(237, 125, 49, 0.08)',
  Monotherapy: 'rgba(46, 139, 87, 0.08)',
}

const GROUP_BORDER_COLORS: Record<string, string> = {
  Pooled: '#2B579A',
  Combinations: '#ED7D31',
  Monotherapy: '#2E8B57',
}

function ComparisonMatrix({
  data,
}: {
  data: {
    columns: ComparisonColumn[]
    columnGroups: Map<string, ComparisonColumn[]>
    terms: string[]
    matrix: Map<string, Map<string, number>>
    maxCount: number
  }
}) {
  const groups = [...data.columnGroups.entries()]

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          AE Comparison ({data.columns.length} columns, {data.terms.length} terms)
        </CardTitle>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            {/* Group header row */}
            <tr className="border-b border-gray-200">
              <th className="sticky left-0 bg-surface" />
              {groups.map(([group, cols]) => (
                <th
                  key={group}
                  colSpan={cols.length}
                  className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider"
                  style={{
                    backgroundColor: GROUP_COLORS[group],
                    borderBottom: `2px solid ${GROUP_BORDER_COLORS[group] ?? '#999'}`,
                  }}
                >
                  {group}
                </th>
              ))}
            </tr>
            {/* Column header row */}
            <tr className="border-b text-text-muted">
              <th className="pb-2 pr-3 text-left sticky left-0 bg-surface min-w-[180px]">AE Term</th>
              {data.columns.map((col) => (
                <th key={col.key} className="pb-2 px-2 text-center min-w-[80px]">
                  <span className="block truncate max-w-[120px]" title={col.label}>
                    {col.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.terms.map((term) => (
              <tr key={term} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-1.5 pr-3 font-medium sticky left-0 bg-surface">{term}</td>
                {data.columns.map((col) => {
                  const count = data.matrix.get(term)?.get(col.key) ?? 0
                  const intensity = data.maxCount > 0 ? count / data.maxCount : 0
                  return (
                    <td
                      key={col.key}
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
  )
}

function ViewToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary text-white' : 'bg-gray-100 text-text-muted hover:bg-gray-200',
      )}
    >
      {label}
    </button>
  )
}
