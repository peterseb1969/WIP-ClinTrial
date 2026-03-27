import { RefreshCw, Database, Clock, FileText } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import { reportQuery } from '@/lib/reporting'

export function SyncPage() {
  // Single SQL query for all template counts + totals
  const { data, isLoading } = useQuery({
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

  const stats = data
  const templateCounts = data?.templateCounts

  if (isLoading) return <PageLoading message="Loading sync status..." />

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sync Status</h1>

      <Card>
        <CardHeader>
          <CardTitle>Data Source</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <dt className="flex items-center gap-2 text-text-muted">
            <Database className="h-4 w-4" />
            Source
          </dt>
          <dd className="font-medium">ClinicalTrials.gov API v2</dd>

          <dt className="flex items-center gap-2 text-text-muted">
            <RefreshCw className="h-4 w-4" />
            Sync method
          </dt>
          <dd className="font-medium">Incremental (3-layer change detection)</dd>

          <dt className="flex items-center gap-2 text-text-muted">
            <Clock className="h-4 w-4" />
            Sponsors
          </dt>
          <dd className="font-medium">Hoffmann-La Roche, Genentech Inc.</dd>
        </dl>
      </Card>

      {/* Total stats */}
      <Card>
        <CardHeader>
          <CardTitle>Namespace: clintrials</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatBox label="Total Documents" value={formatNumber(stats?.totalDocs ?? 0)} />
          <StatBox label="Templates" value="6" />
          <StatBox label="Terminologies" value="9" />
        </div>
      </Card>

      {/* Per-template breakdown */}
      {templateCounts && (
        <Card>
          <CardHeader>
            <CardTitle>Documents by Template</CardTitle>
          </CardHeader>
          <div className="space-y-2">
            {Object.entries(templateCounts).map(([tmpl, count]) => (
              <div key={tmpl} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-text-muted" />
                  {tmpl}
                </span>
                <span className="font-medium tabular-nums">{formatNumber(count)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="border-amber-200 bg-amber-50/50">
        <p className="text-sm text-amber-800">
          Sync is performed via the CLI: <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">python scripts/import_trials.py</code>
          <br />
          Use <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">--full</code> for complete reimport or run without flags for incremental sync.
        </p>
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
