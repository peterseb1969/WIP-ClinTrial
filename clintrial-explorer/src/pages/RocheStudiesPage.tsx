import { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { PageLoading } from '@/components/LoadingSpinner'
import { ErrorMessage } from '@/components/ErrorMessage'
import { useRocheStudies, useRocheStudyDetail } from '@/hooks/useRocheStudies'

const PAGE_SIZE = 50

const TABLE_COLUMNS = [
  { key: 'source', label: 'Source', width: 'w-20' },
  { key: 'study_number', label: 'Study #', width: 'w-28' },
  { key: 'study_phase', label: 'Phase', width: 'w-24' },
  { key: 'study_status', label: 'Status', width: 'w-28' },
  { key: 'study_type', label: 'Type', width: 'w-32' },
  { key: 'therapeutic_area', label: 'TA', width: 'w-20' },
  { key: 'indication', label: 'Indication', width: '' },
  { key: 'theme_molecule', label: 'Molecule', width: 'w-28' },
  { key: 'nct_id', label: 'NCT ID', width: 'w-28' },
] as const

const SKIP_DETAIL_KEYS = new Set([
  'document_id', 'namespace', 'template_id', 'template_version', 'version',
  'identity_hash', 'created_by', 'updated_by', 'data_json',
  'term_references_json', 'file_references_json', 'status',
])

export function RocheStudiesPage() {
  const { data: studies, isLoading, error } = useRocheStudies()
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<string | null>(null)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [tableOpen, setTableOpen] = useState(true)

  const filtered = useMemo(() => {
    if (!studies) return []
    return studies.filter((s) => {
      for (const [key, val] of Object.entries(filters)) {
        if (!val) continue
        const field = String(s[key] || '').toUpperCase()
        if (!field.includes(val.toUpperCase())) return false
      }
      return true
    })
  }, [studies, filters])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const { data: detail } = useRocheStudyDetail(selectedId, selectedSource)

  const setFilter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(1)
  }

  if (isLoading) return <PageLoading message="Loading Roche studies..." />
  if (error) return <ErrorMessage message={(error as Error).message} />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">TA Portal / MDMS</h1>
        <span className="text-sm text-text-muted">
          {filtered.length} of {studies?.length ?? 0} studies
          {Object.values(filters).some(Boolean) && ' (filtered)'}
        </span>
      </div>

      {/* Table */}
      <Card>
        <button
          onClick={() => setTableOpen(!tableOpen)}
          className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-text hover:bg-gray-50"
        >
          <span>Study Table</span>
          {tableOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {tableOpen && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    {TABLE_COLUMNS.map((col) => (
                      <th key={col.key} className={cn('px-2 py-1.5 text-left text-xs font-medium text-text-muted', col.width)}>
                        <div className="space-y-1">
                          <span>{col.label}</span>
                          <input
                            type="text"
                            value={filters[col.key] || ''}
                            onChange={(e) => setFilter(col.key, e.target.value)}
                            placeholder="Filter..."
                            className="block w-full rounded border border-gray-200 px-1.5 py-0.5 text-[11px] font-normal focus:border-primary focus:outline-none"
                          />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((s) => (
                    <tr
                      key={`${s.source}-${s.document_id}`}
                      onClick={() => {
                        setSelectedId(s.document_id)
                        setSelectedSource(s.source)
                      }}
                      className={cn(
                        'cursor-pointer border-b border-gray-50 text-xs hover:bg-gray-50',
                        selectedId === s.document_id && 'bg-primary/5',
                      )}
                    >
                      <td className="px-2 py-1.5">
                        <Badge variant={s.source === 'ta_portal' ? 'primary' : 'muted'}>
                          {s.source === 'ta_portal' ? 'TA' : 'MDMS'}
                        </Badge>
                      </td>
                      <td className="px-2 py-1.5 font-mono">{s.study_number}</td>
                      <td className="px-2 py-1.5">{s.study_phase || '—'}</td>
                      <td className="px-2 py-1.5">{s.study_status || '—'}</td>
                      <td className="px-2 py-1.5 truncate max-w-[8rem]">{s.study_type || '—'}</td>
                      <td className="px-2 py-1.5">{s.therapeutic_area || '—'}</td>
                      <td className="px-2 py-1.5 truncate max-w-[12rem]">{s.indication || '—'}</td>
                      <td className="px-2 py-1.5">{s.theme_molecule || '—'}</td>
                      <td className="px-2 py-1.5 font-mono">{s.nct_id || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-2">
                <span className="text-xs text-text-muted">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                    className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-30"
                  >
                    First
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-30"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-30"
                  >
                    Next
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages}
                    className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-30"
                  >
                    Last
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Detail panel */}
      {selectedId && detail && (
        <Card>
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">
                {String(detail.study_number || selectedId)}
              </h3>
              <Badge variant={selectedSource === 'ta_portal' ? 'primary' : 'muted'}>
                {selectedSource === 'ta_portal' ? 'TA Portal' : 'MDMS'}
              </Badge>
            </div>
            <button
              onClick={() => { setSelectedId(null); setSelectedSource(null) }}
              className="rounded p-1 text-text-muted hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 p-4">
            {Object.entries(detail)
              .filter(([k, v]) => v != null && String(v).trim() !== '' && !SKIP_DETAIL_KEYS.has(k) && !k.endsWith('_term_id') && !k.endsWith('_search'))
              .map(([key, val]) => (
                <div key={key} className="flex gap-2 py-0.5 text-sm">
                  <dt className="w-36 shrink-0 text-text-muted">{key}</dt>
                  <dd className="min-w-0 break-words font-medium">{String(val)}</dd>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  )
}
