import { useState, useMemo } from 'react'
import { Upload, Play, Square, RotateCcw, Database, FileText, Clock, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { Badge } from '@/components/Badge'
import { formatNumber } from '@/lib/utils'
import { reportQuery } from '@/lib/reporting'
import { useImportJob, useSyncState, type ImportOptions } from '@/hooks/useImport'

const DEFAULT_SPONSORS = ['Hoffmann-La Roche', 'Genentech, Inc.']

export function ImportPage() {
  const importJob = useImportJob()
  const { data: syncState, isLoading: loadingSyncState } = useSyncState()

  // Import form state
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental')
  const [sponsors, setSponsors] = useState(DEFAULT_SPONSORS.join('\n'))
  const [nctIds, setNctIds] = useState('')
  const [sinceDate, setSinceDate] = useState('')
  const [limit, setLimit] = useState('')
  const [skipPdfs, setSkipPdfs] = useState(false)

  // Namespace stats (same as old SyncPage)
  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['clintrial', 'sync-stats'],
    queryFn: async () => {
      const [templateResult, totalResult] = await Promise.all([
        reportQuery<{ table_name: string; cnt: number }>(
          `SELECT 'CT_TRIAL' as table_name, COUNT(*) as cnt FROM doc_ct_trial
           UNION ALL SELECT 'CT_ORGANIZATION', COUNT(*) FROM doc_ct_organization
           UNION ALL SELECT 'CT_TRIAL_OUTCOME', COUNT(*) FROM doc_ct_trial_outcome
           UNION ALL SELECT 'CT_TRIAL_SITE', COUNT(*) FROM doc_ct_trial_site
           UNION ALL SELECT 'CT_TRIAL_AE', COUNT(*) FROM doc_ct_trial_ae
           UNION ALL SELECT 'CT_TRIAL_BASELINE', COUNT(*) FROM doc_ct_trial_baseline`,
        ),
        reportQuery<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM doc_ct_trial
           UNION ALL SELECT COUNT(*) FROM doc_ct_organization
           UNION ALL SELECT COUNT(*) FROM doc_ct_trial_outcome
           UNION ALL SELECT COUNT(*) FROM doc_ct_trial_site
           UNION ALL SELECT COUNT(*) FROM doc_ct_trial_ae
           UNION ALL SELECT COUNT(*) FROM doc_ct_trial_baseline`,
        ),
      ])

      const templateCounts: Record<string, number> = {}
      for (const row of templateResult.rows) {
        templateCounts[row.table_name] = Number(row.cnt)
      }
      const totalDocs = totalResult.rows.reduce((sum, r) => sum + Number(r.cnt), 0)
      return { templateCounts, totalDocs }
    },
    staleTime: 60 * 1000,
  })

  const parsedSyncState = useMemo(() => {
    if (!syncState) return null
    try {
      const trialsState = syncState.trials_state ? JSON.parse(syncState.trials_state) : {}
      const lastSummary = syncState.last_import_summary ? JSON.parse(syncState.last_import_summary) : null
      return {
        lastSync: syncState.last_sync,
        trialCount: Object.keys(trialsState).length,
        lastSummary,
      }
    } catch {
      return null
    }
  }, [syncState])

  function handleStart() {
    const sponsorList = sponsors.split('\n').map((s) => s.trim()).filter(Boolean)
    const nctIdList = nctIds.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)

    const options: ImportOptions = {
      mode,
      sponsors: sponsorList.length > 0 ? sponsorList : undefined,
      nctIds: nctIdList.length > 0 ? nctIdList : undefined,
      sinceDate: sinceDate || undefined,
      limit: limit ? parseInt(limit) : undefined,
      skipPdfs,
    }

    importJob.start(options)
  }

  if (loadingStats) return <PageLoading message="Loading import status..." />

  const progress = importJob.progress
  const counts = progress?.counts

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Upload className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Import</h1>
      </div>

      {/* Import Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Import from ClinicalTrials.gov</CardTitle>
        </CardHeader>
        <div className="space-y-4">
          {/* Mode */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={mode === 'incremental'}
                onChange={() => setMode('incremental')}
                disabled={importJob.isRunning}
                className="accent-primary"
              />
              Incremental (only new/updated)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={mode === 'full'}
                onChange={() => setMode('full')}
                disabled={importJob.isRunning}
                className="accent-primary"
              />
              Full reimport
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Sponsors */}
            <div>
              <label className="text-xs font-medium text-text-muted">Sponsors (one per line)</label>
              <textarea
                value={sponsors}
                onChange={(e) => setSponsors(e.target.value)}
                disabled={importJob.isRunning}
                rows={3}
                className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* NCT IDs */}
            <div>
              <label className="text-xs font-medium text-text-muted">NCT IDs (optional, comma or newline separated)</label>
              <textarea
                value={nctIds}
                onChange={(e) => setNctIds(e.target.value)}
                disabled={importJob.isRunning}
                rows={3}
                placeholder="NCT12345678, NCT87654321"
                className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {/* Since Date */}
            <div>
              <label className="text-xs font-medium text-text-muted">Since Date (optional)</label>
              <input
                type="date"
                value={sinceDate}
                onChange={(e) => setSinceDate(e.target.value)}
                disabled={importJob.isRunning}
                className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Limit */}
            <div>
              <label className="text-xs font-medium text-text-muted">Limit (optional)</label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                disabled={importJob.isRunning}
                placeholder="No limit"
                min={1}
                className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Skip PDFs */}
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={skipPdfs}
                  onChange={(e) => setSkipPdfs(e.target.checked)}
                  disabled={importJob.isRunning}
                  className="accent-primary"
                />
                Skip PDF downloads
              </label>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            {!importJob.isRunning && !importJob.completed && (
              <button
                onClick={handleStart}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              >
                <Play className="h-4 w-4" />
                Start Import
              </button>
            )}
            {importJob.isRunning && (
              <button
                onClick={importJob.cancel}
                className="inline-flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90"
              >
                <Square className="h-4 w-4" />
                Cancel
              </button>
            )}
            {importJob.completed && (
              <button
                onClick={importJob.reset}
                className="inline-flex items-center gap-2 rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-text hover:bg-gray-200"
              >
                <RotateCcw className="h-4 w-4" />
                New Import
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Progress Panel */}
      {(importJob.isRunning || importJob.completed || importJob.error) && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2 w-full">
              {importJob.isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {importJob.completed && <CheckCircle2 className="h-4 w-4 text-green-600" />}
              {importJob.error && <AlertCircle className="h-4 w-4 text-danger" />}
              <CardTitle>
                {importJob.isRunning ? 'Import in Progress' : importJob.completed ? 'Import Complete' : 'Import Error'}
              </CardTitle>
            </div>
          </CardHeader>

          {importJob.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{importJob.error}</div>
          )}

          {progress && (
            <div className="space-y-4">
              {/* Phase and step */}
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="primary">{progress.phase}</Badge>
                <span className="text-text-muted">{progress.step}</span>
                {progress.current_nct_id && (
                  <span className="font-mono text-xs text-text-muted">{progress.current_nct_id}</span>
                )}
              </div>

              {/* Progress bar */}
              {progress.total > 0 && (
                <div>
                  <div className="flex justify-between text-xs text-text-muted mb-1">
                    <span>{progress.processed} / {progress.total}</span>
                    <span>{Math.round((progress.processed / progress.total) * 100)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${Math.min(100, (progress.processed / progress.total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Counters */}
              {counts && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <CounterBox label="Trials created" value={counts.trials_created} />
                  <CounterBox label="Trials updated" value={counts.trials_updated} />
                  <CounterBox label="Trials skipped" value={counts.trials_skipped} />
                  <CounterBox label="Orgs created" value={counts.orgs_created} />
                  <CounterBox label="Outcomes" value={counts.outcomes_created} />
                  <CounterBox label="Sites" value={counts.sites_created} />
                  <CounterBox label="AEs" value={counts.aes_created} />
                  <CounterBox label="Baselines" value={counts.baselines_created} />
                  <CounterBox label="Files uploaded" value={counts.files_uploaded} />
                  <CounterBox label="Errors" value={counts.errors} variant={counts.errors > 0 ? 'danger' : 'default'} />
                </div>
              )}

              {/* Error log */}
              {counts && counts.error_log && counts.error_log.length > 0 && (
                <ErrorLog errors={counts.error_log} />
              )}
            </div>
          )}
        </Card>
      )}

      {/* Sync State */}
      {!loadingSyncState && parsedSyncState && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Clock className="mr-2 inline h-4 w-4" />
              Sync State
            </CardTitle>
          </CardHeader>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <dt className="text-text-muted">Last Sync</dt>
            <dd className="font-medium">{parsedSyncState.lastSync || 'Never'}</dd>
            <dt className="text-text-muted">Tracked Trials</dt>
            <dd className="font-medium">{formatNumber(parsedSyncState.trialCount)}</dd>
          </dl>
          {parsedSyncState.lastSummary && (
            <div className="mt-3 rounded-md bg-gray-50 p-3">
              <p className="text-xs font-medium text-text-muted mb-1">Last Import Summary</p>
              <div className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
                {Object.entries(parsedSyncState.lastSummary).map(([key, val]) => (
                  <span key={key}>
                    <span className="text-text-muted">{key.replace(/_/g, ' ')}:</span>{' '}
                    <span className="font-medium">{String(val)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Namespace Stats */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Database className="mr-2 inline h-4 w-4" />
            Namespace: clintrial
          </CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 mb-4">
          <StatBox label="Total Documents" value={formatNumber(stats?.totalDocs ?? 0)} />
          <StatBox label="Data Source" value="ClinicalTrials.gov" />
          <StatBox label="Sync Method" value="Incremental" />
        </div>
        {stats?.templateCounts && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-muted">Documents by Template</p>
            {Object.entries(stats.templateCounts).map(([tmpl, count]) => (
              <div key={tmpl} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-text-muted" />
                  {tmpl}
                </span>
                <span className="font-medium tabular-nums">{formatNumber(count)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  )
}

function ErrorLog({ errors }: { errors: string[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-md border border-red-200 bg-red-50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <AlertCircle className="h-4 w-4" />
        {errors.length} error{errors.length !== 1 ? 's' : ''} — click to {expanded ? 'hide' : 'show'} details
      </button>
      {expanded && (
        <div className="max-h-64 overflow-y-auto border-t border-red-200 px-3 py-2">
          {errors.map((err, i) => (
            <div key={i} className="py-0.5 font-mono text-xs text-red-700">
              {err}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CounterBox({ label, value, variant = 'default' }: { label: string; value: number; variant?: 'default' | 'danger' }) {
  return (
    <div className={`rounded-md border p-2 text-center ${variant === 'danger' && value > 0 ? 'border-red-200 bg-red-50' : ''}`}>
      <p className={`text-lg font-bold tabular-nums ${variant === 'danger' && value > 0 ? 'text-danger' : ''}`}>
        {formatNumber(value)}
      </p>
      <p className="text-[10px] text-text-muted">{label}</p>
    </div>
  )
}
