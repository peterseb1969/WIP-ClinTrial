import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, ChevronDown, ChevronUp, Download } from 'lucide-react'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { BookmarkButton } from '@/components/BookmarkButton'
import { StatusBadge } from '@/components/StatusBadge'
import { PageLoading } from '@/components/LoadingSpinner'
import { ErrorMessage } from '@/components/ErrorMessage'
import { type TrialDocument } from '@/hooks/useAllTrials'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useTrialFilters, type FilterKey } from '@/hooks/useTrialFilters'
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

  // Reset page when a filter changes via the local controls
  const updateFilter = (key: FilterKey, value: string | null) => {
    setFilter(key, value)
    setPage(1)
  }

  const exportCsv = () => {
    const header = ['NCT ID', 'Brief Title', 'Status', 'Phase', 'Sponsor', 'Enrollment', 'Start Date', 'Has Results']
    const rows = filtered.map((t) => [
      t.data.nct_id,
      `"${(t.data.brief_title || t.data.title).replace(/"/g, '""')}"`,
      t.data.status,
      (t.data.phases || []).join(';'),
      t.data.sponsor,
      String(t.data.enrollment || ''),
      t.data.start_date || '',
      String(t.data.has_results),
    ])
    const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trials-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
            onChange={(e) => updateFilter('search', e.target.value || null)}
            className="w-full rounded-lg border border-gray-300 bg-surface py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Quick filters */}
        <QuickFilters filters={filters} setFilter={updateFilter} trials={allTrials ?? []} />
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

      {/* Actions bar */}
      <div className="flex items-center gap-3">
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-text-muted hover:bg-gray-50"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>

        {filtered.length > 0 && (
          <button
            onClick={() => setAggregateOpen(!aggregateOpen)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-text-muted hover:bg-gray-50"
          >
            {aggregateOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Aggregate View ({filtered.length} trials)
          </button>
        )}
      </div>

      {/* Aggregate panel */}
      {aggregateOpen && <AggregatePanel trials={filtered} />}
    </div>
  )
}

/** Quick filter buttons extracted from the data */
function QuickFilters({
  filters,
  setFilter,
  trials,
}: {
  filters: Partial<Record<FilterKey, string>>
  setFilter: (key: FilterKey, value: string | null) => void
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
        value={filters.status}
        options={statuses.map(([v, c]: [string, number]) => ({ value: v, label: `${v.replace(/_/g, ' ')} (${c})` }))}
        onChange={(v) => setFilter('status', v)}
      />
      <FilterSelect
        label="Phase"
        value={filters.phase}
        options={phases.map(([v, c]: [string, number]) => ({ value: v, label: `${formatPhase(v)} (${c})` }))}
        onChange={(v) => setFilter('phase', v)}
      />
      <FilterToggle
        label="Has Results"
        active={filters.has_results === 'true'}
        onClick={() => setFilter('has_results', filters.has_results === 'true' ? null : 'true')}
      />
      <FilterToggle
        label="Bookmarked"
        active={filters.bookmarked === 'true'}
        onClick={() => setFilter('bookmarked', filters.bookmarked === 'true' ? null : 'true')}
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

/** Aggregate summary panel for filtered trials */
function AggregatePanel({ trials }: { trials: TrialDocument[] }) {
  // Simple aggregations from the trial data itself
  const totalEnrollment = trials.reduce((sum, t) => sum + (t.data.enrollment || 0), 0)
  const withResults = trials.filter((t) => t.data.has_results).length

  const topConditions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of trials) {
      for (const c of t.data.conditions || []) {
        counts.set(c, (counts.get(c) || 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [trials])

  const topMolecules = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of trials) {
      for (const m of t.data.interventions || []) {
        counts.set(m, (counts.get(m) || 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [trials])

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Aggregate Summary</h3>
      <div className="grid gap-6 md:grid-cols-3">
        {/* Stats */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-text-muted">Overview</h4>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">Trials</dt>
              <dd className="font-medium">{formatNumber(trials.length)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">Total enrollment</dt>
              <dd className="font-medium">{formatNumber(totalEnrollment)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">With results</dt>
              <dd className="font-medium">{withResults} ({Math.round((withResults / trials.length) * 100)}%)</dd>
            </div>
          </dl>
        </div>

        {/* Top conditions */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-text-muted">Top Conditions</h4>
          <ul className="space-y-1 text-sm">
            {topConditions.map(([name, count]: [string, number]) => (
              <li key={name} className="flex justify-between">
                <span className="truncate pr-2">{name}</span>
                <span className="flex-shrink-0 text-text-muted">{count}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Top molecules */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-text-muted">Top Molecules</h4>
          <ul className="space-y-1 text-sm">
            {topMolecules.map(([name, count]: [string, number]) => (
              <li key={name} className="flex justify-between">
                <span className="truncate pr-2">{name}</span>
                <span className="flex-shrink-0 text-text-muted">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}
