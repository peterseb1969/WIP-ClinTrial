import { useState, useMemo, useEffect } from 'react'
import { Sparkles, X, Check, AlertTriangle, Loader2 } from 'lucide-react'
import {
  useProposeAECleanup,
  useApplyAECleanup,
  type AECleanupCluster,
} from '@/hooks/useAECleanup'
import { formatNumber } from '@/lib/utils'

interface Props {
  onClose: () => void
}

/** Modal for AI-assisted AE term cleanup. */
export function AECleanupModal({ onClose }: Props) {
  const propose = useProposeAECleanup()
  const apply = useApplyAECleanup()
  const [approved, setApproved] = useState<Set<number>>(new Set())
  const [applyResult, setApplyResult] = useState<{
    created: number
    updated: number
    deleted: number
    errors: number
  } | null>(null)

  const clusters = propose.data?.clusters ?? []
  const stats = propose.data?.stats

  // Pre-approve high-confidence clusters (>= 0.9) when results arrive
  useEffect(() => {
    if (clusters.length > 0 && approved.size === 0) {
      const pre = new Set<number>()
      clusters.forEach((c, i) => {
        if (c.confidence >= 0.9) pre.add(i)
      })
      setApproved(pre)
    }
  }, [clusters, approved.size])

  const approvedClusters = useMemo(
    () => clusters.filter((_, i) => approved.has(i)),
    [clusters, approved],
  )

  const toggle = (i: number) => {
    setApproved((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  const toggleAll = () => {
    if (approved.size === clusters.length) {
      setApproved(new Set())
    } else {
      setApproved(new Set(clusters.map((_, i) => i)))
    }
  }

  const handleApply = async () => {
    try {
      const result = await apply.mutateAsync(approvedClusters)
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
              <button
                onClick={() => propose.mutate()}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              >
                <Sparkles className="h-4 w-4" />
                Analyze AE terms
              </button>
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
                  {clusters.length} cluster{clusters.length === 1 ? '' : 's'} proposed
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

              {clusters.length === 0 ? (
                <div className="rounded-md border bg-gray-50 p-6 text-center text-sm text-text-muted">
                  No clusters worth merging. Your AE terms look clean already.
                </div>
              ) : (
                <>
                  {/* Bulk select */}
                  <div className="flex items-center justify-between text-xs">
                    <button onClick={toggleAll} className="text-primary hover:underline">
                      {approved.size === clusters.length ? 'Deselect all' : 'Select all'}
                    </button>
                    <span className="text-text-muted">
                      {approved.size} of {clusters.length} selected
                    </span>
                  </div>

                  {/* Cluster list */}
                  <div className="space-y-2">
                    {clusters.map((c, i) => (
                      <ClusterCard
                        key={i}
                        cluster={c}
                        approved={approved.has(i)}
                        onToggle={() => toggle(i)}
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
        {propose.data && !applyResult && clusters.length > 0 && (
          <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
            <button
              onClick={handleClose}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={approved.size === 0 || apply.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40"
            >
              {apply.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Apply {approved.size} cluster{approved.size === 1 ? '' : 's'}
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
}: {
  cluster: AECleanupCluster
  approved: boolean
  onToggle: () => void
}) {
  const confidenceColor =
    cluster.confidence >= 0.9
      ? 'text-green-700 bg-green-100'
      : cluster.confidence >= 0.7
        ? 'text-amber-700 bg-amber-100'
        : 'text-red-700 bg-red-100'

  return (
    <label
      className={`block cursor-pointer rounded-md border p-3 transition-colors ${
        approved ? 'border-primary bg-primary/5' : 'border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={approved}
          onChange={onToggle}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">→ {cluster.canonical}</span>
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
            {cluster.variants.map((v) => (
              <span
                key={v}
                className="rounded-full bg-white border px-2 py-0.5 text-[11px] text-text-muted"
              >
                {v}
              </span>
            ))}
          </div>
          {cluster.reason && (
            <p className="mt-1.5 text-[11px] italic text-text-muted">{cluster.reason}</p>
          )}
        </div>
      </div>
    </label>
  )
}
