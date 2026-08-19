import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, TestTubes, Download, Search, X, ListPlus, ListChecks, ListX } from 'lucide-react'
import { Card } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { ErrorMessage } from '@/components/ErrorMessage'
import { useSampleInventory, type StudySamples, type SamiRow } from '@/hooks/useSampleInventory'
import { useStudyBasket } from '@/hooks/useStudyBasket'
import { formatNumber } from '@/lib/utils'

const PAGE_SIZE = 50

const SAMPLE_TYPE_OPTIONS = [
  'Plasma', 'Serum', 'Blood', 'DNA', 'RNA', 'CSF', 'PBMC', 'Urine',
  'Unstained fixed slide', 'H and E fixed slide', 'Fixed Block', 'Stool',
]

function exportCsv(studies: StudySamples[], detailed: boolean) {
  let csv: string
  if (detailed) {
    csv = 'roche_id,nct_id,title,sample_type,available,marked_for_disposal,in_circulation,disposed,total,participants,snapshot_date\n'
    for (const s of studies) {
      for (const r of s.rows) {
        csv += [s.org_study_id, s.nct_id, `"${(s.brief_title || '').replace(/"/g, '""')}"`,
          r.sample_type, r.available, r.marked_for_disposal, r.in_circulation,
          r.disposed, r.total_count, r.unique_participants, r.snapshot_date,
        ].join(',') + '\n'
      }
    }
  } else {
    csv = 'roche_id,nct_id,title,total_available,plasma,serum,blood,dna,csf,tissue,other,total_count\n'
    for (const s of studies) {
      csv += [s.org_study_id, s.nct_id, `"${(s.brief_title || '').replace(/"/g, '""')}"`,
        s.total_available, s.plasma, s.serum, s.blood, s.dna, s.csf, s.tissue, s.other, s.total_count,
      ].join(',') + '\n'
    }
  }
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = detailed ? 'sample_inventory_detail.csv' : 'sample_inventory.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export function SamplesPage() {
  const { studies, stats, isLoading, error } = useSampleInventory()
  const basket = useStudyBasket()
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<string>('total_available')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [allExpanded, setAllExpanded] = useState(false)
  const [showBasketOnly, setShowBasketOnly] = useState(false)

  // Local sample filters
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set())
  const [minAvailable, setMinAvailable] = useState(0)

  if (isLoading) return <PageLoading message="Loading sample inventory..." />
  if (error) return <ErrorMessage message={(error as Error).message} />

  const toggleRow = (nctId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(nctId)) next.delete(nctId); else next.add(nctId)
      return next
    })
  }

  const toggleAllExpanded = () => {
    if (allExpanded) {
      setExpandedRows(new Set())
      setAllExpanded(false)
    } else {
      setExpandedRows(new Set(studies.map((s) => s.nct_id)))
      setAllExpanded(true)
    }
  }

  const isRowExpanded = (nctId: string) => allExpanded || expandedRows.has(nctId)

  const filtered = studies.filter((s) => {
    if (showBasketOnly && !basket.has(s.nct_id)) return false
    if (minAvailable > 0 && s.total_available < minAvailable) return false
    if (typeFilter.size > 0) {
      const hasType = s.rows.some((r) => r.available > 0 && typeFilter.has(r.sample_type))
      if (!hasType) return false
    }
    if (search) {
      const q = search.toLowerCase()
      const searchable = `${s.org_study_id} ${s.nct_id} ${s.brief_title}`.toLowerCase()
      if (!searchable.includes(q)) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
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

  const toggleType = (type: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      return next
    })
    setPage(1)
  }

  const clearFilters = () => { setSearch(''); setTypeFilter(new Set()); setMinAvailable(0); setShowBasketOnly(false); setPage(1) }
  const hasLocalFilters = search || typeFilter.size > 0 || minAvailable > 0 || showBasketOnly

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TestTubes className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-text">Sample Inventory</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCsv(sorted, false)}
            className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium text-text-muted hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5" /> Summary CSV
          </button>
          <button
            onClick={() => exportCsv(sorted, true)}
            className="inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs font-medium text-text-muted hover:bg-gray-50"
          >
            <Download className="h-3.5 w-3.5" /> Detail CSV
          </button>
        </div>
      </div>

      {/* Stat tiles */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Trials with Samples" value={formatNumber(filtered.length)} sub={`of ${formatNumber(studies.length)} total`} />
          <StatTile label="Available Samples" value={formatNumber(filtered.reduce((s, st) => s + st.total_available, 0))} />
          <StatTile label="Coverage" value={`${stats.coverage}%`} sub="of filtered trials" />
          <StatTile label="Roche Studies" value={formatNumber(new Set(filtered.map((s) => s.org_study_id)).size)} />
        </div>
      )}

      {/* Basket bar */}
      <div className="flex items-center gap-3 rounded-lg border bg-surface px-4 py-2.5 text-sm">
        <ListChecks className="h-4 w-4 text-primary" />
        <span>
          <strong className="text-text">{basket.count}</strong>
          <span className="text-text-muted"> studies in list</span>
        </span>
        {basket.count > 0 && (
          <button
            onClick={() => { setShowBasketOnly(!showBasketOnly); setPage(1) }}
            className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${
              showBasketOnly
                ? 'bg-primary text-white'
                : 'border border-primary/30 text-primary hover:bg-primary/5'
            }`}
          >
            {showBasketOnly ? 'Showing list only' : 'Show list only'}
          </button>
        )}
        {showBasketOnly && basket.count === 0 && (
          <button
            onClick={() => { setShowBasketOnly(false); setPage(1) }}
            className="rounded bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800"
          >
            List is empty — show all
          </button>
        )}
        {basket.count > 0 && (
          <button
            onClick={() => { basket.clear(); setShowBasketOnly(false) }}
            className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs text-text-muted hover:bg-gray-50"
          >
            <ListX className="h-3 w-3" /> Clear list
          </button>
        )}
      </div>

      {/* Sample filters */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search study #, NCT ID, or title..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="w-full rounded border border-gray-300 py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-text-muted whitespace-nowrap">Min available:</label>
            <input
              type="number"
              min={0}
              step={100}
              value={minAvailable || ''}
              placeholder="0"
              onChange={(e) => { setMinAvailable(Number(e.target.value) || 0); setPage(1) }}
              className="w-20 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          {hasLocalFilters && (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-text-muted hover:bg-gray-50">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-text-muted self-center mr-1">Sample type:</span>
          {SAMPLE_TYPE_OPTIONS.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                typeFilter.has(t)
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-text-muted hover:bg-gray-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Card>

      {/* Expand/collapse toggle */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-muted">
          {formatNumber(sorted.length)} studies
          {hasLocalFilters && ` (filtered from ${formatNumber(studies.length)})`}
        </span>
        <button
          onClick={toggleAllExpanded}
          className="rounded border px-2.5 py-1 text-xs font-medium text-text-muted hover:bg-gray-50"
        >
          {allExpanded ? 'Collapse all details' : 'Expand all details'}
        </button>
      </div>

      {/* Main table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50/50 text-xs">
                <th className="w-8 px-2 py-2.5" />
                <th className="w-8 px-1 py-2.5" />
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
                <StudyRow
                  key={study.nct_id}
                  study={study}
                  expanded={isRowExpanded(study.nct_id)}
                  onToggleExpand={() => { toggleRow(study.nct_id); setAllExpanded(false) }}
                  inBasket={basket.has(study.nct_id)}
                  onToggleBasket={() => basket.toggle(study.nct_id)}
                />
              ))}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-12 text-center text-text-muted">
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

function StudyRow({ study, expanded, onToggleExpand, inBasket, onToggleBasket }: {
  study: StudySamples
  expanded: boolean
  onToggleExpand: () => void
  inBasket: boolean
  onToggleBasket: () => void
}) {
  const n = (v: number) => v > 0 ? formatNumber(v) : <span className="text-gray-300">—</span>

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50/50">
        <td className="px-2 py-1.5">
          <button onClick={onToggleExpand} className="rounded p-0.5 hover:bg-gray-200">
            <ChevronRight className={`h-3.5 w-3.5 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        </td>
        <td className="px-1 py-1.5">
          <button
            onClick={onToggleBasket}
            title={inBasket ? 'Remove from list' : 'Add to list'}
            className={`rounded p-0.5 transition-colors ${inBasket ? 'text-primary' : 'text-gray-300 hover:text-primary/60'}`}
          >
            <ListPlus className="h-3.5 w-3.5" />
          </button>
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
          <td colSpan={13} className="bg-gray-50/30 px-6 py-2">
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
          <th className="pb-1 pr-4 font-medium text-right">Total</th>
          <th className="pb-1 pr-4 font-medium text-right">Participants</th>
          <th className="pb-1 font-medium text-right">Snapshot</th>
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
            <td className="py-1 pr-4 text-right">{formatNumber(row.total_count)}</td>
            <td className="py-1 pr-4 text-right text-text-muted">{row.unique_participants || '—'}</td>
            <td className="py-1 text-right text-text-muted">{row.snapshot_date}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="text-center">
      <p className="text-2xl font-bold text-text">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
      {sub && <p className="text-[10px] text-text-muted">{sub}</p>}
    </Card>
  )
}
