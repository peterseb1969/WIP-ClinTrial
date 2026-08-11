import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Check,
  X,
  SkipForward,
  Loader2,
  Upload,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import {
  useCurationCandidates,
  useCurationStats,
  useMappedStudyNumbers,
  useLoadCandidates,
  useReviewCandidate,
  useBulkReview,
  useClearCandidates,
  useStudyDetail,
  useTrialDetail,
} from '@/hooks/useCuration'
import { useTrialFilters } from '@/hooks/useTrialFilters'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
] as const

const CONFIDENCE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
] as const

function parseMatchData(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const variant =
    confidence === 'high' ? 'success' : confidence === 'medium' ? 'accent' : 'muted'
  return <Badge variant={variant}>{confidence}</Badge>
}

function StatusIndicator({ status }: { status: string }) {
  if (status === 'APPROVED') return <Check className="h-3.5 w-3.5 text-green-600" />
  if (status === 'REJECTED') return <X className="h-3.5 w-3.5 text-red-500" />
  if (status === 'SKIPPED') return <SkipForward className="h-3.5 w-3.5 text-gray-400" />
  return <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
}

function SignalRow({ signals }: { signals: Record<string, unknown> }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs">
      {signals.title_sim != null && (
        <span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">
          Title: {Number(signals.title_sim).toFixed(2)}
        </span>
      )}
      {Array.isArray(signals.molecule_match) && (
        <span className="rounded bg-green-50 px-2 py-0.5 text-green-700">
          Molecule: {signals.molecule_match.join(', ')}
        </span>
      )}
      {signals.phase_match != null && (
        <span className="rounded bg-purple-50 px-2 py-0.5 text-purple-700">
          Phase: {String(signals.phase_match)}
        </span>
      )}
      {Array.isArray(signals.compound_match) && (
        <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">
          Compound: {signals.compound_match.join(', ')}
        </span>
      )}
      {Array.isArray(signals.product_name_match) && (
        <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">
          Product: {signals.product_name_match.join(', ')}
        </span>
      )}
      {signals.indication_match != null && (
        <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
          Indication: {String(signals.indication_match)}
        </span>
      )}
      {Array.isArray(signals.indication_overlap) && (
        <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">
          Indication: {signals.indication_overlap.slice(0, 3).join(', ')}
        </span>
      )}
      {signals.ta_match != null && (
        <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">
          TA: {String(signals.ta_match)}
        </span>
      )}
      {signals.acronym_match != null && (
        <span className="rounded bg-rose-50 px-2 py-0.5 text-rose-700">
          Acronym match
        </span>
      )}
    </div>
  )
}

function StudyCard({
  title,
  data,
  color,
}: {
  title: string
  data: Record<string, unknown> | null | undefined
  color: string
}) {
  if (data === null) {
    return (
      <Card className={cn('flex-1 border-t-2 border-t-gray-300', color)}>
        <div className="p-4 text-center text-sm text-amber-600">
          Study not found in any database
        </div>
      </Card>
    )
  }
  if (data === undefined) {
    return (
      <Card className={cn('flex-1 border-t-2', color)}>
        <div className="p-4 text-center text-sm text-text-muted">Loading...</div>
      </Card>
    )
  }

  const isMdms = data._source === 'mdms'
  const fields = Object.entries(data).filter(
    ([k, v]) => v != null && v !== '' && !k.endsWith('_term_id') && k !== '_source',
  )

  return (
    <Card className={cn('flex-1 border-t-2', color)}>
      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase text-text-muted">{title}</h4>
          {isMdms && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">MDMS</span>
          )}
        </div>
        <dl className="space-y-1.5">
          {fields.map(([key, val]) => (
            <div key={key} className="flex gap-2 text-sm">
              <dt className="w-28 shrink-0 truncate text-text-muted">{key}</dt>
              <dd className="min-w-0 break-words font-medium">
                {String(val)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  )
}

export function CurationPage() {
  const [searchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState('PENDING')
  const [confidence, setConfidence] = useState('all')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [loadConfidence, setLoadConfidence] = useState('high')
  const [loadedFile, setLoadedFile] = useState<{ name: string; matches: unknown[] } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '')
  const [showMapped, setShowMapped] = useState(false)

  // Pre-fill search from URL params (e.g. ?nct_ids=NCT123,NCT456 or ?search=WO43571)
  useEffect(() => {
    const nctIds = searchParams.get('nct_ids')
    if (nctIds) {
      setSearchQuery(nctIds)
      setStatusFilter('all')
    }
    const search = searchParams.get('search')
    if (search) {
      setSearchQuery(search)
      setStatusFilter('all')
    }
  }, [searchParams])

  const { data: candidates, isLoading, error } = useCurationCandidates(
    'study_crosswalk',
    statusFilter,
    confidence,
  )
  const { data: mappedStudyNumbers } = useMappedStudyNumbers()
  const { hasActive: hasGlobalFilters } = useTrialFilters()
  const { trials: globalFilteredTrials } = useFilteredTrials()

  // Build set of NCT IDs from global trial filters
  const globalNctIds = useMemo(() => {
    if (!hasGlobalFilters) return null
    return new Set(globalFilteredTrials.map((t) => String(t.data?.nct_id || '')))
  }, [hasGlobalFilters, globalFilteredTrials])

  // Client-side filtering: search, mapped toggle, global filters
  const filteredCandidates = useMemo(() => {
    if (!candidates) return []
    let result = candidates

    // Exclude already-mapped studies (unless toggled on)
    if (!showMapped && mappedStudyNumbers) {
      result = result.filter((c) => !mappedStudyNumbers.has(c.item_key))
    }

    // Apply global trial filters — only show candidates whose NCT ID is in the filtered set
    if (globalNctIds) {
      result = result.filter((c) => {
        const md = parseMatchData(c.match_data)
        const nct = String(md.nct_id || '')
        return globalNctIds.has(nct)
      })
    }

    // Text search
    if (searchQuery.trim()) {
      const terms = searchQuery.toUpperCase().trim().split(/[,\s]+/).filter(Boolean)
      result = result.filter((c) => {
        const md = parseMatchData(c.match_data)
        const nct = String(md.nct_id || '').toUpperCase()
        const key = c.item_key.toUpperCase()
        return terms.some((t) => key.includes(t) || nct.includes(t))
      })
    }

    return result
  }, [candidates, searchQuery, showMapped, mappedStudyNumbers, globalNctIds])
  const { data: stats } = useCurationStats()
  const loadMutation = useLoadCandidates()
  const reviewMutation = useReviewCandidate()
  const bulkMutation = useBulkReview()
  const clearMutation = useClearCandidates()

  const selected = filteredCandidates[selectedIdx] ?? null
  const matchData = selected ? parseMatchData(selected.match_data) : null
  const nctId = matchData?.nct_id as string | null

  const { data: taStudy } = useStudyDetail(selected?.item_key ?? null, expanded)
  const { data: ctTrial } = useTrialDetail(nctId, expanded)

  const totalStats = useMemo(() => {
    if (!stats) return { total: 0, pending: 0, approved: 0, rejected: 0, skipped: 0 }
    const crosswalk = stats.filter((s) => s.topic === 'study_crosswalk')
    return {
      total: crosswalk.reduce((acc, s) => acc + s.cnt, 0),
      pending: crosswalk.find((s) => s.status === 'PENDING')?.cnt ?? 0,
      approved: crosswalk.find((s) => s.status === 'APPROVED')?.cnt ?? 0,
      rejected: crosswalk.find((s) => s.status === 'REJECTED')?.cnt ?? 0,
      skipped: crosswalk.find((s) => s.status === 'SKIPPED')?.cnt ?? 0,
    }
  }, [stats])

  const handleReview = useCallback(
    (decision: 'approved' | 'rejected' | 'skipped') => {
      if (!selected) return
      reviewMutation.mutate(
        { document_id: selected.document_id, decision },
        {
          onSuccess: () => {
            if (selectedIdx < filteredCandidates.length - 1) {
              setSelectedIdx((i) => i + 1)
            }
          },
        },
      )
    },
    [selected, reviewMutation, filteredCandidates, selectedIdx],
  )

  const handleBulkApprove = useCallback(() => {
    if (!filteredCandidates.length) return
    const pending = filteredCandidates.filter(
      (c) => c.status === 'PENDING' && c.confidence === 'high',
    )
    const matchDataList = pending.map((c) => parseMatchData(c.match_data))
    const highSim = pending.filter((_, i) => {
      const sim = Number(
        (matchDataList[i].signals as Record<string, unknown>)?.title_sim ?? 0,
      )
      return sim >= 0.95
    })
    if (
      highSim.length > 0 &&
      confirm(`Approve ${highSim.length} high-confidence matches (sim ≥ 0.95)?`)
    ) {
      bulkMutation.mutate({
        document_ids: highSim.map((c) => c.document_id),
        decision: 'approved',
      })
    }
  }, [filteredCandidates, bulkMutation])

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        return
      if (e.key === 'a' || e.key === 'A') handleReview('approved')
      else if (e.key === 'r' || e.key === 'R') handleReview('rejected')
      else if (e.key === 's' || e.key === 'S') handleReview('skipped')
      else if (e.key === 'ArrowDown')
        setSelectedIdx((i) => Math.min(i + 1, filteredCandidates.length - 1))
      else if (e.key === 'ArrowUp') setSelectedIdx((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleReview, filteredCandidates.length])

  // Reset selection when filters change
  useEffect(() => setSelectedIdx(0), [statusFilter, confidence, searchQuery, showMapped])

  const isEmpty = !isLoading && (!candidates || candidates.length === 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text">Data Curation</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (confirm('Delete all curation tasks for study_crosswalk? This cannot be undone.')) {
                clearMutation.mutate('study_crosswalk')
              }
            }}
            disabled={clearMutation.isPending}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {clearMutation.isPending ? 'Clearing...' : 'Clear All'}
          </button>
          <button
            onClick={handleBulkApprove}
            disabled={bulkMutation.isPending}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Bulk Approve (sim ≥ 0.95)
          </button>
        </div>
      </div>

      {/* Candidate count indicator */}
      {candidates && candidates.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filteredCandidates.length} of {candidates.length} candidates
          {(searchQuery || !showMapped || globalNctIds) && (
            <span className="text-primary">
              {' '}(filtered
              {!showMapped && mappedStudyNumbers?.size ? `, ${mappedStudyNumbers.size} mapped excluded` : ''}
              {globalNctIds ? `, ${globalNctIds.size} trials from global filter` : ''}
              {searchQuery ? `, search: "${searchQuery}"` : ''}
              )
            </span>
          )}
        </div>
      )}

      {/* Progress bar */}
      {totalStats.total > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-text-muted">
            <span>
              {totalStats.approved + totalStats.rejected + totalStats.skipped} /{' '}
              {totalStats.total} reviewed
            </span>
            <span>
              <span className="text-green-600">{totalStats.approved} approved</span>
              {' · '}
              <span className="text-red-500">{totalStats.rejected} rejected</span>
              {' · '}
              <span className="text-gray-400">{totalStats.skipped} skipped</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full bg-green-500 transition-all"
              style={{
                width: `${((totalStats.approved + totalStats.rejected + totalStats.skipped) / totalStats.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-gray-300 text-sm">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                'px-3 py-1.5 transition-colors first:rounded-l-md last:rounded-r-md',
                statusFilter === tab.value
                  ? 'bg-primary text-white'
                  : 'text-text-muted hover:bg-gray-50',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <select
          value={confidence}
          onChange={(e) => setConfidence(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
        >
          {CONFIDENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={showMapped}
            onChange={(e) => setShowMapped(e.target.checked)}
            className="rounded border-gray-300"
          />
          Include mapped
        </label>
        <div className="relative ml-auto">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search study number or NCT ID..."
            className="w-64 rounded-md border border-gray-300 py-1.5 pl-7 pr-3 text-sm focus:border-primary focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Load candidates form (when empty) */}
      {isEmpty && (
        <Card>
          <div className="p-6 text-center">
            <Upload className="mx-auto mb-3 h-8 w-8 text-text-muted" />
            <h3 className="mb-1 font-medium">No curation tasks found</h3>
            <p className="mb-4 text-sm text-text-muted">
              Load fuzzy match candidates to start reviewing.
            </p>
            <div className="mx-auto flex max-w-lg items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-left text-xs text-text-muted">
                  Upload fuzzy match file (JSON)
                </label>
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => {
                      try {
                        const matches = JSON.parse(reader.result as string)
                        setLoadedFile({ name: file.name, matches })
                      } catch {
                        setLoadedFile(null)
                      }
                    }
                    reader.readAsText(file)
                  }}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-xs file:text-primary"
                />
              </div>
              <select
                value={loadConfidence}
                onChange={(e) => setLoadConfidence(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="high">High only</option>
                <option value="medium">High + Medium</option>
                <option value="low">All</option>
              </select>
              <button
                onClick={() => {
                  if (!loadedFile) return
                  loadMutation.mutate({
                    matches: loadedFile.matches,
                    min_confidence: loadConfidence,
                  })
                }}
                disabled={!loadedFile || loadMutation.isPending}
                className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {loadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Load'
                )}
              </button>
            </div>
            {loadedFile && (
              <p className="mt-2 text-xs text-text-muted">
                {loadedFile.name}: {loadedFile.matches.length} candidates
              </p>
            )}
            {loadMutation.isSuccess && (
              <p className="mt-3 text-sm text-green-600">
                Loaded: {(loadMutation.data as Record<string, number>).created} created,{' '}
                {(loadMutation.data as Record<string, number>).existing} existing
                {(loadMutation.data as Record<string, number>).skipped_reviewed > 0 && (
                  <span className="text-text-muted">
                    {' '}({(loadMutation.data as Record<string, number>).skipped_reviewed} already reviewed, preserved)
                  </span>
                )}
              </p>
            )}
            {loadMutation.isError && (
              <p className="mt-3 text-sm text-red-500">
                {(loadMutation.error as Error).message}
              </p>
            )}
          </div>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mb-1 inline h-4 w-4" /> {(error as Error).message}
        </div>
      )}

      {/* Search found nothing */}
      {searchQuery && filteredCandidates.length === 0 && candidates && candidates.length > 0 && (
        <Card>
          <div className="p-6 text-center text-sm text-text-muted">
            No candidates matching "{searchQuery}" — {candidates.length} total candidates loaded
          </div>
        </Card>
      )}

      {/* Two-panel layout */}
      {filteredCandidates.length > 0 && (
        <div className="flex gap-4" style={{ height: 'calc(100vh - 320px)' }}>
          {/* Left: candidate list */}
          <div className="w-72 shrink-0 overflow-y-auto rounded-lg border border-gray-200 bg-surface">
            {filteredCandidates.map((c, i) => (
              <button
                key={c.document_id}
                onClick={() => setSelectedIdx(i)}
                className={cn(
                  'flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left text-sm transition-colors',
                  i === selectedIdx
                    ? 'bg-primary/10 font-medium'
                    : 'hover:bg-gray-50',
                )}
              >
                <StatusIndicator status={c.status} />
                <span className="min-w-0 flex-1 truncate">{c.item_key}</span>
                <ConfidenceBadge confidence={c.confidence} />
              </button>
            ))}
          </div>

          {/* Right: detail */}
          <div className="flex-1 space-y-3 overflow-y-auto">
            {selected && matchData && (
              <>
                {/* Match signals */}
                <Card>
                  <div className="flex items-center justify-between p-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{selected.item_key}</span>
                        <ArrowRight />
                        <span className="font-medium">{nctId}</span>
                        <ConfidenceBadge confidence={selected.confidence} />
                      </div>
                      <SignalRow
                        signals={(matchData.signals as Record<string, unknown>) || {}}
                      />
                    </div>
                    {selected.status === 'APPROVED' && (
                      <span className="rounded bg-green-50 px-2 py-1 text-xs text-green-700">
                        Mapped — reviewed by {selected.reviewed_by || 'unknown'}{' '}
                        {selected.reviewed_at ? `on ${selected.reviewed_at.slice(0, 10)}` : ''}
                      </span>
                    )}
                    {selected.status === 'REJECTED' && (
                      <span className="rounded bg-red-50 px-2 py-1 text-xs text-red-600">
                        Rejected{selected.notes ? `: ${selected.notes}` : ''}
                      </span>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleReview('approved')}
                        disabled={
                          reviewMutation.isPending || selected.status !== 'PENDING'
                        }
                        className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        title="Approve (A)"
                      >
                        <Check className="inline h-4 w-4" /> Approve
                      </button>
                      <button
                        onClick={() => handleReview('rejected')}
                        disabled={
                          reviewMutation.isPending || selected.status !== 'PENDING'
                        }
                        className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
                        title="Reject (R)"
                      >
                        <X className="inline h-4 w-4" /> Reject
                      </button>
                      <button
                        onClick={() => handleReview('skipped')}
                        disabled={
                          reviewMutation.isPending || selected.status !== 'PENDING'
                        }
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-gray-50 disabled:opacity-50"
                        title="Skip (S)"
                      >
                        <SkipForward className="inline h-4 w-4" /> Skip
                      </button>
                    </div>
                  </div>
                </Card>

                {/* Side-by-side study cards */}
                <div className="flex items-center justify-end">
                  <button
                    onClick={() => setExpanded((e) => !e)}
                    className="flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 text-xs text-text-muted hover:bg-gray-50"
                  >
                    {expanded ? (
                      <>
                        <ChevronUp className="h-3 w-3" /> Compact view
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" /> Show all fields
                      </>
                    )}
                  </button>
                </div>
                <div className="flex gap-3">
                  <StudyCard
                    title="Roche Study"
                    data={taStudy}
                    color="border-t-primary"
                  />
                  <StudyCard
                    title="ClinicalTrials.gov"
                    data={ctTrial}
                    color="border-t-accent"
                  />
                </div>

                {/* Full titles comparison — prefer DB values, fall back to match_data */}
                <Card>
                  <div className="space-y-2 p-3 text-sm">
                    <div>
                      <span className="text-xs font-semibold text-primary">
                        Roche Title (from match data):
                      </span>
                      <p>{String(matchData.roche_title || '—')}</p>
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-accent">
                        CT.gov Title:
                      </span>
                      <p>
                        {ctTrial
                          ? String(ctTrial.title || ctTrial.brief_title || '—')
                          : String(matchData.ctgov_title || '—')}
                      </p>
                    </div>
                  </div>
                </Card>

                {/* Keyboard hint */}
                <p className="text-xs text-text-muted">
                  Keyboard: <kbd className="rounded border px-1">A</kbd> approve{' '}
                  <kbd className="rounded border px-1">R</kbd> reject{' '}
                  <kbd className="rounded border px-1">S</kbd> skip{' '}
                  <kbd className="rounded border px-1">↑↓</kbd> navigate
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ArrowRight() {
  return (
    <svg className="h-4 w-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}
