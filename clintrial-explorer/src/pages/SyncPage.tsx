import { RefreshCw, Database, Clock, FileText } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useWipClient } from '@wip/react'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { formatNumber } from '@/lib/utils'

export function SyncPage() {
  const client = useWipClient()

  const { data: stats, isLoading } = useQuery({
    queryKey: ['clintrial', 'namespace-stats'],
    queryFn: async () => {
      const ns = await client.registry.getNamespaceStats('clintrial')
      return ns
    },
    staleTime: 60 * 1000,
  })

  // Fetch document counts per template
  const { data: templateCounts } = useQuery({
    queryKey: ['clintrial', 'template-counts'],
    queryFn: async () => {
      const templates = ['CT_TRIAL', 'CT_ORGANIZATION', 'CT_TRIAL_OUTCOME', 'CT_TRIAL_SITE', 'CT_TRIAL_AE', 'CT_TRIAL_BASELINE']
      const counts: Record<string, number> = {}
      for (const tmpl of templates) {
        const result = await client.documents.listDocuments({
          template_value: tmpl,
          status: 'active',
          page_size: 1,
        })
        counts[tmpl] = result.total
      }
      return counts
    },
    staleTime: 60 * 1000,
  })

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

      {/* Namespace stats */}
      <Card>
        <CardHeader>
          <CardTitle>Namespace: clintrial</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatBox label="Documents" value={formatNumber(stats?.entity_counts?.documents ?? 0)} />
          <StatBox label="Templates" value={String(stats?.entity_counts?.templates ?? 0)} />
          <StatBox label="Terminologies" value={String(stats?.entity_counts?.terminologies ?? 0)} />
          <StatBox label="Terms" value={formatNumber(stats?.entity_counts?.terms ?? 0)} />
          <StatBox label="Files" value={formatNumber(stats?.entity_counts?.files ?? 0)} />
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
