import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, TestTubes } from 'lucide-react'
import { Card } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { ErrorMessage } from '@/components/ErrorMessage'
import { GlobalFilterBar } from '@/components/GlobalFilterBar'
import { useSampleInventory, type StudySamples, type SamiRow } from '@/hooks/useSampleInventory'
import { formatNumber } from '@/lib/utils'

const PAGE_SIZE = 50

function useStickyToggle(key: string, defaultOpen = false) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(key) === 'true' } catch { return defaultOpen }
  })
  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      try { localStorage.setItem(key, String(next)) } catch { /* */ }
      return next
    })
  }, [key])
  return [open, toggle] as const
}

export function SamplesPage() {
  const { studies, stats, isLoading, error } = useSampleInventory()
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<string>('total_available')
  const [sortAsc, setSortAsc] = useState(false)
  const [expanded, toggleExpanded] = useStickyToggle('clintrial-samples-expanded')

  if (isLoading) return <PageLoading message="Loading sample inventory..." />
  if (error) return <ErrorMessage message={(error as Error).message} />

  const sorted = [...studies].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey]
    const bv = (b as unknown as Record<string, unknown>)[sortKey]
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv
      : String(av || '').localeCompare(String(bv || ''))
    return sortAsc ? cmp : -cmp
  })

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSort = (key: string) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  const SortHeader = ({ k, label, right }: { k: string; label: string; right?: boolean }) => (
    <th
      className={`cursor-pointer px-2 py-2.5 font-medium text-text-muted hover:text-text ${right ? 'text-right' : 'text-left'}`}
      onClick={() => handleSort(k)}
    >
      {label}
      {sortKey === k && <span className="ml-0.5">{sortAsc ? '↑' : '↓'}</span>}
    </th>
  )

  return (
    <div className="space-y-4">
      <GlobalFilterBar />

      <div className="flex items-center gap-3">
        <TestTubes className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold text-text">Sample Inventory</h1>
      </div>

      {/* Stat tiles */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Trials with Samples" value={formatNumber(stats.trialsWithSamples)} />
          <StatTile label="Available Samples" value={formatNumber(stats.totalAvailable)} />
          <StatTile label="Coverage" value={`${stats.coverage}%`} />
          <StatTile label="Roche Studies" value={formatNumber(stats.totalStudies)} />
        </div>
      )}

      {/* Expand/collapse toggle */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-muted">
          {formatNumber(sorted.length)} studies with sample data
        </span>
        <button
          onClick={toggleExpanded}
          className="rounded border px-2.5 py-1 text-xs font-medium text-text-muted hover:bg-gray-50"
        >
          {expanded ? 'Collapse all details' : 'Expand all details'}
        </button>
      </div>

      {/* Main table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50/50 text-xs">
                <th className="w-8 px-2 py-2.5" />
                <SortHeader k="org_study_id" label="Roche ID" />
                <SortHeader k="nct_id" label="NCT ID" />
                <th className="px-2 py-2.5 text-left font-medium text-text-muted">Title</th>
                <SortHeader k="total_available" label="Available" right />
                <SortHeader k="plasma" label="Plasma" right />
                <SortHeader k="serum" label="Serum" right />
                <SortHeader k="blood" label="Blood" right />
                <SortHeader k="dna" label="DNA" right />
                <SortHeader k="csf" label="CSF" right />
                <SortHeader k="tissue" label="Tissue" right />
                <SortHeader k="other" label="Other" right />
              </tr>
            </thead>
            <tbody>
              {paginated.map((study) => (
                <StudyRow key={study.nct_id} study={study} expanded={expanded} />
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-12 text-center text-text-muted">
                    No studies with sample data match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="rounded border px-3 py-1 disabled:opacity-40">Prev</button>
          <span className="text-text-muted">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  )
}

function StudyRow({ study, expanded }: { study: StudySamples; expanded: boolean }) {
  const n = (v: number) => v > 0 ? formatNumber(v) : <span className="text-gray-300">—</span>

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50/50">
        <td className="px-2 py-1.5">
          <ChevronRight className={`h-3.5 w-3.5 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </td>
        <td className="px-2 py-1.5 font-mono text-xs text-primary">
          {study.org_study_id}
        </td>
        <td className="px-2 py-1.5 font-mono text-xs">
          <Link to={`/trials/${study.nct_id}`} className="text-primary hover:underline">
            {study.nct_id}
          </Link>
        </td>
        <td className="max-w-xs truncate px-2 py-1.5" title={study.brief_title}>
          {study.brief_title}
        </td>
        <td className="px-2 py-1.5 text-right font-medium tabular-nums">
          {formatNumber(study.total_available)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{n(study.plasma)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{n(study.serum)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{n(study.blood)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{n(study.dna)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{n(study.csf)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{n(study.tissue)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{n(study.other)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-100">
          <td colSpan={12} className="bg-gray-50/30 px-6 py-2">
            <DetailTable rows={study.rows} />
          </td>
        </tr>
      )}
    </>
  )
}

function DetailTable({ rows }: { rows: SamiRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-text-muted">
          <th className="pb-1 pr-4 font-medium">Sample Type</th>
          <th className="pb-1 pr-4 font-medium text-right">Available</th>
          <th className="pb-1 pr-4 font-medium text-right">Marked Disp.</th>
          <th className="pb-1 pr-4 font-medium text-right">In Circ.</th>
          <th className="pb-1 pr-4 font-medium text-right">Disposed</th>
          <th className="pb-1 font-medium text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.sample_type} className="border-t border-gray-100">
            <td className="py-1 pr-4 font-medium">{row.sample_type}</td>
            <td className="py-1 pr-4 text-right font-medium">{formatNumber(row.available)}</td>
            <td className="py-1 pr-4 text-right text-text-muted">{row.marked_for_disposal || '—'}</td>
            <td className="py-1 pr-4 text-right text-text-muted">{formatNumber(row.in_circulation)}</td>
            <td className="py-1 pr-4 text-right text-text-muted">{row.disposed || '—'}</td>
            <td className="py-1 text-right">{formatNumber(row.total_count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="text-center">
      <p className="text-2xl font-bold text-text">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </Card>
  )
}
