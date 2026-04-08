import { useState, useMemo, useEffect } from 'react'
import {
  Sparkles,
  X,
  Check,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
} from 'lucide-react'
import {
  useProposeAECleanup,
  useApplyAECleanup,
  useAECleanupStats,
  type AECleanupCluster,
} from '@/hooks/useAECleanup'
import { formatNumber } from '@/lib/utils'

interface Props {
  onClose: () => void
}

type SortMode = 'desc' | 'asc' | 'none'

/** Modal for AI-assisted AE term cleanup. */
export function AECleanupModal({ onClose }: Props) {
  const propose = useProposeAECleanup()
  const apply = useApplyAECleanup()
  const cheapStats = useAECleanupStats(!propose.data && !propose.isPending)
  const [approved, setApproved] = useState<Set<number>>(new Set())
  const [caseExpanded, setCaseExpanded] = useState(false)
  const [caseApplied, setCaseApplied] = useState(false)
  const [sortMode, setSortMode] = useState<SortMode>('desc')
  const [maxTerms, setMaxTerms] = useState(3000)
  // Per-cluster variant removals (session-only, indexed by original reviewClusters index).
  const [removedVariants, setRemovedVariants] = useState<Record<number, Set<string>>>({})
  const [caseApplyResult, setCaseApplyResult] = useState<{
    created: number
    updated: number
    deleted: number
    errors: number
  } | null>(null)
  const [applyResult, setApplyResult] = useState<{
    created: number
    updated: number
    deleted: number
    errors: number
  } | null>(null)

  const allClusters = propose.data?.clusters ?? []
  const stats = propose.data?.stats

  // Split off the auto-generated case-only clusters (reason set by the server
  // in collapseCaseVariants). They're confidence 1.0 and reviewing them is
  // just noise — they get their own Apply button. Everything else came from
  // Claude and needs human review.
  const { caseClusters, reviewClusters } = useMemo(() => {
    const cc: AECleanupCluster[] = []
    const rc: AECleanupCluster[] = []
    for (const c of allClusters) {
      if (c.reason.startsWith('Case-only variants')) cc.push(c)
      else rc.push(c)
    }
    return { caseClusters: cc, reviewClusters: rc }
  }, [allClusters])

  // Apply per-variant removals and drop clusters whose variants are now empty.
  // Returns the live clusters plus a map from live-index → original-index, so
  // approval/removal state stays keyed on the stable original index.
  const liveReviewClusters = useMemo(() => {
    const out: Array<{ cluster: AECleanupCluster; originalIndex: number }> = []
    reviewClusters.forEach((c, origIdx) => {
      const removed = removedVariants[origIdx]
      const variants = removed ? c.variants.filter((v) => !removed.has(v)) : c.variants
      if (variants.length === 0) return
      out.push({
        cluster: { ...c, variants },
        originalIndex: origIdx,
      })
    })
    return out
  }, [reviewClusters, removedVariants])

  const sortedLiveClusters = useMemo(() => {
    if (sortMode === 'none') return liveReviewClusters
    const copy = [...liveReviewClusters]
    copy.sort((a, b) =>
      sortMode === 'desc'
        ? b.cluster.confidence - a.cluster.confidence
        : a.cluster.confidence - b.cluster.confidence,
    )
    return copy
  }, [liveReviewClusters, sortMode])

  // Pre-approve high-confidence review clusters (>= 0.9) when results arrive
  useEffect(() => {
    if (reviewClusters.length > 0 && approved.size === 0) {
      const pre = new Set<number>()
      reviewClusters.forEach((c, i) => {
        if (c.confidence >= 0.9) pre.add(i)
      })
      setApproved(pre)
    }
  }, [reviewClusters, approved.size])

  const approvedLiveClusters = useMemo(
    () =>
      liveReviewClusters
        .filter(({ originalIndex }) => approved.has(originalIndex))
        .map(({ cluster }) => cluster),
    [liveReviewClusters, approved],
  )

  const toggle = (origIdx: number) => {
    setApproved((prev) => {
      const next = new Set(prev)
      if (next.has(origIdx)) next.delete(origIdx)
      else next.add(origIdx)
      return next
    })
  }

  const toggleAll = () => {
    const liveIdxSet = new Set(liveReviewClusters.map((x) => x.originalIndex))
    const allSelected = [...liveIdxSet].every((i) => approved.has(i))
    if (allSelected) {
      setApproved((prev) => {
        const next = new Set(prev)
        liveIdxSet.forEach((i) => next.delete(i))
        return next
      })
    } else {
      setApproved((prev) => {
        const next = new Set(prev)
        liveIdxSet.forEach((i) => next.add(i))
        return next
      })
    }
  }

  const removeVariant = (origIdx: number, variant: string) => {
    setRemovedVariants((prev) => {
      const next = { ...prev }
      const set = new Set(next[origIdx] ?? [])
      set.add(variant)
      next[origIdx] = set
      return next
    })
    // If the cluster ends up empty, drop it from `approved` too.
    setApproved((prev) => {
      const cluster = reviewClusters[origIdx]
      if (!cluster) return prev
      const removed = new Set(removedVariants[origIdx] ?? [])
      removed.add(variant)
      const remaining = cluster.variants.filter((v) => !removed.has(v))
      if (remaining.length === 0 && prev.has(origIdx)) {
        const next = new Set(prev)
        next.delete(origIdx)
        return next
      }
      return prev
    })
  }

  const cycleSort = () => {
    setSortMode((m) => (m === 'desc' ? 'asc' : m === 'asc' ? 'none' : 'desc'))
  }

  const handleApplyCaseOnly = async () => {
    try {
      const result = await apply.mutateAsync(caseClusters)
      setCaseApplyResult({
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        errors: result.errors.length,
      })
      setCaseApplied(true)
    } catch (e) {
      console.error(e)
    }
  }

  const handleApply = async () => {
    try {
      const result = await apply.mutateAsync(approvedLiveClusters)
      setApplyResult({
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
        errors: result.errors.length,
      })
    } catch (e) {
      console.error(e)
    }
  }

  const handleClose = () => {
    onClose()
  }

  const liveSelectedCount = liveReviewClusters.filter(({ originalIndex }) =>
    approved.has(originalIndex),
  ).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">AI-Assisted AE Term Cleanup</h2>
          </div>
          <button onClick={handleClose} className="text-text-muted hover:text-text">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Step 1: Intro */}
          {!propose.data && !propose.isPending && (
            <div className="space-y-4">
              <p className="text-sm text-text-muted">
                This uses Claude to cluster raw adverse event strings by semantic equivalence —
                spelling variants, typos, pluralizations, abbreviations, and obvious synonyms.
                You review each proposed cluster before anything is written to WIP.
              </p>
              {cheapStats.data && (
                <div className="rounded-md border bg-gray-50 px-3 py-2 text-xs text-text-muted">
                  <div className="font-medium text-text">Current state (free preview):</div>
                  <ul className="mt-1 space-y-0.5">
                    <li>
                      {formatNumber(cheapStats.data.raw_term_count)} distinct raw AE strings
                    </li>
                    <li>{formatNumber(cheapStats.data.existing_term_count)} existing canonical terms</li>
                    <li>
                      {formatNumber(cheapStats.data.unmapped_count)} unmapped (→{' '}
                      {formatNumber(cheapStats.data.unique_lowercase_count)} after case collapse,
                      {' '}
                      {formatNumber(cheapStats.data.case_collapsed_count)} trivial merges will be
                      auto-applied)
                    </li>
                  </ul>
                </div>
              )}
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <div>
                    <strong>Safety:</strong> Claude will NOT cluster distinct conditions
                    (hypertension ≠ hypotension). High-confidence clusters (≥90%) are
                    pre-checked, but review each one before applying. Merges are not reversible.
                  </div>
                </div>
              </div>
              <div className="flex items-end gap-3">
                <label className="flex flex-col text-xs text-text-muted">
                  <span className="mb-1">Max terms sent to Claude</span>
                  <input
                    type="number"
                    min={100}
                    max={10000}
                    step={100}
                    value={maxTerms}
                    onChange={(e) => setMaxTerms(Number(e.target.value) || 0)}
                    className="w-32 rounded-md border px-2 py-1.5 text-sm text-text"
                  />
                </label>
                <button
                  onClick={() => propose.mutate({ maxTerms })}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
                >
                  <Sparkles className="h-4 w-4" />
                  Analyze AE terms
                </button>
              </div>
              <p className="text-[11px] text-text-muted">
                Higher = more complete coverage but more tokens and $ cost. Default 3000.
              </p>
            </div>
          )}

          {/* Step 2: Loading */}
          {propose.isPending && (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Analyzing AE terms with Claude…</p>
              <p className="mt-1 text-xs">This can take 10–30 seconds.</p>
            </div>
          )}

          {/* Step 3: Error */}
          {propose.isError && (
            <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
              {propose.error.message}
            </div>
          )}

          {/* Step 4: Results */}
          {propose.data && !applyResult && (
            <div className="space-y-3">
              {/* Stats */}
              <div className="flex flex-wrap items-center gap-4 rounded-md border bg-gray-50 px-3 py-2 text-xs text-text-muted">
                <span>{formatNumber(stats!.raw_term_count)} raw terms</span>
                <span>·</span>
                <span>{formatNumber(stats!.existing_term_count)} existing canonicals</span>
                <span>·</span>
                <span>{formatNumber(stats!.unmapped_count)} unmapped</span>
                <span>·</span>
                <span>
                  {caseClusters.length} case-only + {liveReviewClusters.length} reviewable
                </span>
                {stats!.truncated && (
                  <span className="text-amber-600">
                    (truncated to top {formatNumber(stats!.sent_to_claude ?? 0)} by frequency)
                  </span>
                )}
                {stats!.usage && (
                  <span className="ml-auto">
                    {formatNumber(stats!.usage.input_tokens)} in /{' '}
                    {formatNumber(stats!.usage.output_tokens)} out
                  </span>
                )}
              </div>

              {/* Case-only banner with its own Apply button */}
              {caseClusters.length > 0 && (
                <div
                  className={`rounded-md border ${
                    caseApplied ? 'border-green-300 bg-green-100' : 'border-green-200 bg-green-50'
                  }`}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      onClick={() => setCaseExpanded((v) => !v)}
                      className="flex flex-1 items-center gap-2 text-left text-xs"
                    >
                      {caseExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-green-700" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-green-700" />
                      )}
                      <Check className="h-3.5 w-3.5 text-green-700" />
                      <span className="font-medium text-green-800">
                        {caseClusters.length} case-only merge
                        {caseClusters.length === 1 ? '' : 's'}
                      </span>
                      <span className="text-green-700">
                        — deterministic (e.g. HEADACHE / Headache / headache)
                      </span>
                    </button>
                    {caseApplied ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-green-200 px-2 py-1 text-[11px] font-medium text-green-900">
                        <Check className="h-3 w-3" />
                        Applied
                        {caseApplyResult && (
                          <span className="font-normal">
                            {' '}
                            ({caseApplyResult.created}+/{caseApplyResult.updated}↑
                            {caseApplyResult.errors > 0
                              ? `/${caseApplyResult.errors}!`
                              : ''}
                            )
                          </span>
                        )}
                      </span>
                    ) : (
                      <button
                        onClick={handleApplyCaseOnly}
                        disabled={apply.isPending}
                        className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-40"
                      >
                        {apply.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        Apply case-only
                      </button>
                    )}
                  </div>
                  {caseExpanded && (
                    <div className="max-h-64 overflow-y-auto border-t border-green-200 px-3 py-2 text-[11px]">
                      <div className="space-y-1">
                        {caseClusters.map((c, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="font-medium text-green-900">→ {c.canonical}</span>
                            <span className="text-green-700">
                              {c.variants.filter((v) => v !== c.canonical).join(', ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {liveReviewClusters.length === 0 ? (
                <div className="rounded-md border bg-gray-50 p-6 text-center text-sm text-text-muted">
                  No Claude-proposed clusters. Your non-case AE terms look clean already.
                </div>
              ) : (
                <>
                  {/* Bulk select + sort */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <button onClick={toggleAll} className="text-primary hover:underline">
                        {liveSelectedCount === liveReviewClusters.length
                          ? 'Deselect all'
                          : 'Select all'}
                      </button>
                      <button
                        onClick={cycleSort}
                        className="inline-flex items-center gap-1 text-text-muted hover:text-text"
                        title="Toggle sort"
                      >
                        {sortMode === 'desc' ? (
                          <ArrowDown className="h-3.5 w-3.5" />
                        ) : sortMode === 'asc' ? (
                          <ArrowUp className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpDown className="h-3.5 w-3.5" />
                        )}
                        Confidence
                        {sortMode === 'desc' && ' (high → low)'}
                        {sortMode === 'asc' && ' (low → high)'}
                        {sortMode === 'none' && ' (original order)'}
                      </button>
                    </div>
                    <span className="text-text-muted">
                      {liveSelectedCount} of {liveReviewClusters.length} selected
                    </span>
                  </div>

                  {/* Cluster list */}
                  <div className="space-y-2">
                    {sortedLiveClusters.map(({ cluster, originalIndex }) => (
                      <ClusterCard
                        key={originalIndex}
                        cluster={cluster}
                        approved={approved.has(originalIndex)}
                        onToggle={() => toggle(originalIndex)}
                        onRemoveVariant={(v) => removeVariant(originalIndex, v)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 5: Apply result */}
          {applyResult && (
            <div className="space-y-3">
              <div className="rounded-md border border-green-200 bg-green-50 p-4">
                <div className="flex items-start gap-2">
                  <Check className="mt-0.5 h-5 w-5 text-green-600" />
                  <div className="text-sm">
                    <p className="font-semibold text-green-800">Cleanup applied</p>
                    <ul className="mt-1 space-y-0.5 text-green-700">
                      <li>{applyResult.created} new canonical terms created</li>
                      <li>{applyResult.updated} existing terms updated with new aliases</li>
                      <li>{applyResult.deleted} redundant term entries removed</li>
                      {applyResult.errors > 0 && (
                        <li className="text-amber-700">{applyResult.errors} errors</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {propose.data && !applyResult && liveReviewClusters.length > 0 && (
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <button
              onClick={handleClose}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={liveSelectedCount === 0 || apply.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40"
            >
              {apply.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Apply {liveSelectedCount} reviewed
            </button>
          </div>
        )}

        {applyResult && (
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <button
              onClick={handleClose}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ClusterCard({
  cluster,
  approved,
  onToggle,
  onRemoveVariant,
}: {
  cluster: AECleanupCluster
  approved: boolean
  onToggle: () => void
  onRemoveVariant: (variant: string) => void
}) {
  const confidenceColor =
    cluster.confidence >= 0.9
      ? 'text-green-700 bg-green-100'
      : cluster.confidence >= 0.7
        ? 'text-amber-700 bg-amber-100'
        : 'text-red-700 bg-red-100'

  return (
    <div
      className={`block rounded-md border p-3 transition-colors ${
        approved ? 'border-primary bg-primary/5' : 'border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={approved}
          onChange={onToggle}
          className="mt-1 h-4 w-4 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">→ {cluster.canonical}</span>
            {cluster.existing_canonical && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                merge into existing
              </span>
            )}
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${confidenceColor}`}
            >
              {Math.round(cluster.confidence * 100)}%
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {cluster.variants.map((v) => {
              const isCanonical = v === cluster.canonical
              return (
                <span
                  key={v}
                  className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-[11px] text-text-muted"
                >
                  {v}
                  {!isCanonical && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveVariant(v)
                      }}
                      className="text-text-muted hover:text-danger"
                      title="Remove from cluster"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              )
            })}
          </div>
          {cluster.reason && (
            <p className="mt-1.5 text-[11px] italic text-text-muted">{cluster.reason}</p>
          )}
        </div>
      </div>
    </div>
  )
}
