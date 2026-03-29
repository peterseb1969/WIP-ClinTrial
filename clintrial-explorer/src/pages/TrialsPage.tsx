import { useMemo, useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { BookmarkButton } from '@/components/BookmarkButton'
import { CsvDownloadButton } from '@/components/CsvDownloadButton'
import { SqlInspector } from '@/components/SqlInspector'
import { StatusBadge } from '@/components/StatusBadge'
import { PageLoading } from '@/components/LoadingSpinner'
import { ErrorMessage } from '@/components/ErrorMessage'
import { type TrialDocument, allTrialsQueries } from '@/hooks/useAllTrials'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useTrialFilters, trialFilters, type SingleFilterKey } from '@/hooks/useTrialFilters'
import { reportQuery } from '@/lib/reporting'
import { formatPhase } from '@/lib/trial-utils'
import { cn, formatNumber } from '@/lib/utils'

const PAGE_SIZE = 25

export function TrialsPage() {
  const navigate = useNavigate()
  const { trials: filtered, allTrials, isLoading, error, refetch } = useFilteredTrials()
  const { filters, set: setFilter } = useTrialFilters()
  const [page, setPage] = useState(1)
  const [aggregateOpen, setAggregateOpen] = useState(false)

  // Paginate
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // For single-value filters (search, toggles)
  const updateSingleFilter = (key: SingleFilterKey, value: string | null) => {
    setFilter(key, value)
    setPage(1)
  }

  const getCsvData = useCallback(() => ({
    columns: ['NCT ID', 'Brief Title', 'Status', 'Phase', 'Sponsor', 'Enrollment', 'Start Date', 'Has Results'],
    rows: filtered.map((t) => [
      t.data.nct_id,
      t.data.brief_title || t.data.title,
      t.data.status,
      (t.data.phases || []).join(';'),
      t.data.sponsor,
      String(t.data.enrollment || ''),
      t.data.start_date || '',
      String(t.data.has_results),
    ]),
  }), [filtered])

  if (isLoading) return <PageLoading message="Loading trials..." />
  if (error) return <ErrorMessage message={error.message} onRetry={() => refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trials</h1>
        <span className="text-sm text-text-muted">
          {formatNumber(filtered.length)} of {formatNumber(allTrials?.length ?? 0)} trials
        </span>
      </div>

      {/* Search + quick filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search NCT ID, title, conditions, molecules..."
            value={filters.search || ''}
            onChange={(e) => updateSingleFilter('search', e.target.value || null)}
            className="w-full rounded-lg border border-gray-300 bg-surface py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Quick filters */}
        <QuickFilters filters={filters} trials={allTrials ?? []} />
      </div>

      {/* Aggregate summary (collapsed by default, at top for visibility) */}
      {filtered.length > 0 && (
        <AggregatePanel trials={filtered} open={aggregateOpen} onToggle={() => setAggregateOpen(!aggregateOpen)} />
      )}

      {/* Actions bar */}
      <div className="flex items-center gap-3">
        <CsvDownloadButton getData={getCsvData} filenamePrefix="trials-export" />
      </div>

      {/* Results table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="w-10 px-3 py-2.5" />
                <th className="px-3 py-2.5 text-left font-medium text-text-muted">NCT ID</th>
                <th className="px-3 py-2.5 text-left font-medium text-text-muted">Title</th>
                <th className="px-3 py-2.5 text-left font-medium text-text-muted">Status</th>
                <th className="px-3 py-2.5 text-left font-medium text-text-muted">Phase</th>
                <th className="px-3 py-2.5 text-left font-medium text-text-muted">Sponsor</th>
                <th className="px-3 py-2.5 text-right font-medium text-text-muted">Enrolled</th>
                <th className="px-3 py-2.5 text-left font-medium text-text-muted">Start</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((trial) => (
                <tr
                  key={trial.document_id}
                  className="border-b border-gray-100 hover:bg-gray-50/50 cursor-pointer"
                  onClick={() => navigate(`/trials/${trial.data.nct_id}`)}
                >
                  <td className="px-3 py-2">
                    <BookmarkButton nctId={trial.data.nct_id} size="sm" />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-primary">
                    <Link
                      to={`/trials/${trial.data.nct_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      {trial.data.nct_id}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2" title={trial.data.brief_title || trial.data.title}>
                    {trial.data.brief_title || trial.data.title}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={trial.data.status} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {(trial.data.phases || []).map((p) => (
                        <Badge key={p} variant="muted">{formatPhase(p)}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{trial.data.sponsor}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{trial.data.enrollment ?? '—'}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">{trial.data.start_date ?? '—'}</td>
                </tr>
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-text-muted">
                    No trials match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-text-muted">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </Card>

      <SqlInspector queries={allTrialsQueries} />
    </div>
  )
}

/** Quick filter buttons extracted from the data */
function QuickFilters({
  filters,
  trials,
}: {
  filters: ReturnType<typeof useTrialFilters>['filters']
  trials: TrialDocument[]
}) {
  // Collect unique values for dropdowns
  const statuses = useMemo(() => {
    const s = new Map<string, number>()
    for (const t of trials) {
      s.set(t.data.status, (s.get(t.data.status) || 0) + 1)
    }
    return [...s.entries()].sort((a, b) => b[1] - a[1])
  }, [trials])

  const phases = useMemo(() => {
    const p = new Map<string, number>()
    for (const t of trials) {
      for (const ph of t.data.phases || []) {
        p.set(ph, (p.get(ph) || 0) + 1)
      }
    }
    return [...p.entries()].sort((a, b) => b[1] - a[1])
  }, [trials])

  return (
    <div className="flex flex-wrap gap-2">
      <FilterSelect
        label="Status"
        value={filters.status?.join(', ')}
        options={statuses.map(([v, c]: [string, number]) => ({ value: v, label: `${v.replace(/_/g, ' ')} (${c})` }))}
        onChange={(v) => v ? trialFilters.toggle('status', v) : trialFilters.removeKey('status')}
      />
      <FilterSelect
        label="Phase"
        value={filters.phase?.join(', ')}
        options={phases.map(([v, c]: [string, number]) => ({ value: v, label: `${formatPhase(v)} (${c})` }))}
        onChange={(v) => v ? trialFilters.toggle('phase', v) : trialFilters.removeKey('phase')}
      />
      <FilterToggle
        label="Has Results"
        active={filters.has_results === 'true'}
        onClick={() => trialFilters.toggle('has_results', 'true')}
      />
      <FilterToggle
        label="Has AE Data"
        active={filters.has_ae_data === 'true'}
        onClick={() => trialFilters.toggle('has_ae_data', 'true')}
      />
      <FilterToggle
        label="Has Outcomes"
        active={filters.has_outcomes === 'true'}
        onClick={() => trialFilters.toggle('has_outcomes', 'true')}
      />
      <FilterToggle
        label="Has Baseline"
        active={filters.has_baseline === 'true'}
        onClick={() => trialFilters.toggle('has_baseline', 'true')}
      />
      <FilterToggle
        label="Has Protocol"
        active={filters.has_protocol === 'true'}
        onClick={() => trialFilters.toggle('has_protocol', 'true')}
      />
      <FilterToggle
        label="Bookmarked"
        active={filters.bookmarked === 'true'}
        onClick={() => trialFilters.toggle('bookmarked', 'true')}
      />
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value?: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string | null) => void
}) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        'rounded-md border px-2 py-1 text-xs',
        value ? 'border-primary bg-primary/5 text-primary' : 'border-gray-300 text-text-muted',
      )}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function FilterToggle({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-gray-300 text-text-muted hover:border-gray-400',
      )}
    >
      {label}
    </button>
  )
}

/** Collapsible aggregate summary panel with enhanced stats */
function AggregatePanel({ trials, open, onToggle }: { trials: TrialDocument[]; open: boolean; onToggle: () => void }) {
  const totalEnrollment = useMemo(() => trials.reduce((sum, t) => sum + (t.data.enrollment || 0), 0), [trials])
  const withResults = useMemo(() => trials.filter((t) => t.data.has_results).length, [trials])

  const nctIds = useMemo(() => trials.map((t) => t.data.nct_id), [trials])

  // Site/country stats from reporting (lazy, only when expanded)
  const { data: siteStats } = useQuery({
    queryKey: ['clintrial', 'aggregate-sites', nctIds.sort().join(',')],
    queryFn: async () => {
      if (nctIds.length === 0) return { countries: 0, sites: 0 }
      const result = await reportQuery<{ countries: number; sites: number }>(
        `SELECT COUNT(DISTINCT country) as countries, COUNT(*) as sites
         FROM doc_ct_trial_site
         WHERE nct_id = ANY($1)`,
        [nctIds],
      )
      const row = result.rows[0]
      return { countries: Number(row?.countries ?? 0), sites: Number(row?.sites ?? 0) }
    },
    enabled: open && nctIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const moleculeStats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of trials) {
      for (const m of t.data.interventions || []) {
        counts.set(m, (counts.get(m) || 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [trials])

  const taStats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of trials) {
      for (const ta of t.data.therapeutic_areas || []) {
        counts.set(ta, (counts.get(ta) || 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [trials])

  const conditionStats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of trials) {
      for (const c of t.data.conditions || []) {
        counts.set(c, (counts.get(c) || 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [trials])

  const sponsorStats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of trials) {
      if (t.data.sponsor) counts.set(t.data.sponsor, (counts.get(t.data.sponsor) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [trials])

  // Collapsed: compact summary strip
  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          {open
            ? <ChevronDown className="h-4 w-4 text-text-muted" />
            : <ChevronRight className="h-4 w-4 text-text-muted" />}
          <span className="text-sm font-semibold">Summary</span>
        </div>
        {/* Always-visible compact stats */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span><strong className="text-text">{formatNumber(trials.length)}</strong> trials</span>
          <span><strong className="text-text">{formatNumber(totalEnrollment)}</strong> enrolled</span>
          <span><strong className="text-text">{moleculeStats.length}</strong> molecules</span>
          <span><strong className="text-text">{taStats.length}</strong> TAs</span>
          {siteStats && <span><strong className="text-text">{siteStats.countries}</strong> countries</span>}
        </div>
      </button>

      {open && (
        <div className="border-t px-4 py-4">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {/* Overview */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Overview</h4>
              <dl className="space-y-1.5 text-sm">
                <StatRow label="Trials" value={formatNumber(trials.length)} />
                <StatRow label="Total enrollment" value={formatNumber(totalEnrollment)} />
                <StatRow label="With results" value={`${withResults} (${trials.length > 0 ? Math.round((withResults / trials.length) * 100) : 0}%)`} />
                <StatRow label="Sponsors" value={formatNumber(sponsorStats.length)} />
                {siteStats && (
                  <>
                    <StatRow label="Countries" value={formatNumber(siteStats.countries)} />
                    <StatRow label="Sites" value={formatNumber(siteStats.sites)} />
                  </>
                )}
              </dl>
            </div>

            {/* Therapeutic Areas */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Therapeutic Areas ({taStats.length})
              </h4>
              <TopList items={taStats} limit={8} formatName={(n) => n.replace(/_/g, ' ')} />
            </div>

            {/* Molecules */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Molecules ({moleculeStats.length})
              </h4>
              <TopList items={moleculeStats} limit={8} />
            </div>

            {/* Conditions */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Conditions ({conditionStats.length})
              </h4>
              <TopList items={conditionStats} limit={8} />
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

function TopList({ items, limit, formatName }: {
  items: Array<[string, number]>; limit: number; formatName?: (n: string) => string
}) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? items : items.slice(0, limit)

  return (
    <>
      <ul className="space-y-1 text-sm">
        {visible.map(([name, count]) => (
          <li key={name} className="flex justify-between">
            <span className="truncate pr-2">{formatName ? formatName(name) : name}</span>
            <span className="flex-shrink-0 text-text-muted tabular-nums text-xs">{count}</span>
          </li>
        ))}
      </ul>
      {items.length > limit && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {showAll ? 'Show less' : `Show all ${items.length}`}
        </button>
      )}
    </>
  )
}
