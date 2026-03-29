import { useMemo, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Pill, FlaskConical, AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { ChipLink } from '@/components/ChipLink'
import { CsvDownloadButton } from '@/components/CsvDownloadButton'
import { SqlInspector, type SqlQuery } from '@/components/SqlInspector'
import { PageLoading } from '@/components/LoadingSpinner'
import { useAllTrials } from '@/hooks/useAllTrials'
import { reportQuery } from '@/lib/reporting'
import { countBy, deduplicateConditions, formatStatus, formatPhase } from '@/lib/trial-utils'
import { formatNumber } from '@/lib/utils'

const PIE_COLORS = ['#2B579A', '#5B9BD5', '#ED7D31', '#2E8B57', '#DC3545', '#7C4DFF', '#00BCD4', '#FF9800']

export function MoleculeDetailPage() {
  const { name } = useParams<{ name: string }>()
  const moleculeName = name ? decodeURIComponent(name) : ''
  const [showAllTrials, setShowAllTrials] = useState(false)

  // Fetch molecule term metadata from WIP API
  const { data: termData, isLoading: loadingTerm } = useQuery({
    queryKey: ['clintrial', 'molecule-term', moleculeName],
    queryFn: async () => {
      // Resolve terminology ID by value
      const lookupRes = await fetch(
        '/api/def-store/terminologies/by-value/CT_MOLECULE?namespace=clintrial',
        { headers: { 'X-API-Key': import.meta.env.VITE_WIP_API_KEY } },
      )
      if (!lookupRes.ok) return null
      const terminology = await lookupRes.json()
      const terminologyId = terminology.terminology_id
      if (!terminologyId) return null

      const res = await fetch(
        `/api/def-store/terminologies/${terminologyId}/terms?search=${encodeURIComponent(moleculeName)}&page_size=50`,
        { headers: { 'X-API-Key': import.meta.env.VITE_WIP_API_KEY } },
      )
      if (!res.ok) return null
      const data = await res.json()
      return data.items?.find((t: Record<string, unknown>) => t.value === moleculeName) ?? null
    },
    enabled: !!moleculeName,
    staleTime: 10 * 60 * 1000,
  })

  // Get trials using this molecule from the cached trial list
  const { data: allTrials, isLoading: loadingTrials } = useAllTrials()
  const moleculeTrials = useMemo(() => {
    if (!allTrials) return []
    return allTrials.filter((t) => t.data.interventions?.includes(moleculeName))
  }, [allTrials, moleculeName])

  // Derive stats
  const byStatus = useMemo(() => countBy(moleculeTrials, (d) => d.status), [moleculeTrials])
  const byPhase = useMemo(() => countBy(moleculeTrials, (d) => d.phases), [moleculeTrials])
  const byCondition = useMemo(() => deduplicateConditions(countBy(moleculeTrials, (d) => d.conditions)).slice(0, 15), [moleculeTrials])
  const byTherapeuticArea = useMemo(() => countBy(moleculeTrials, (d) => d.therapeutic_areas), [moleculeTrials])

  // Fetch top AEs for this molecule via SQL
  const moleculeNctIds = useMemo(() => moleculeTrials.map((t) => t.data.nct_id), [moleculeTrials])
  const aeSql = useMemo(() => {
    if (moleculeNctIds.length === 0) return ''
    const placeholders = moleculeNctIds.map((_, i) => `$${i + 1}`).join(', ')
    return `SELECT term, organ_system, COUNT(*) as cnt
         FROM doc_ct_trial_ae
         WHERE nct_id IN (${placeholders})
         GROUP BY term, organ_system
         ORDER BY cnt DESC
         LIMIT 20`
  }, [moleculeNctIds])

  const { data: topAEs } = useQuery({
    queryKey: ['clintrial', 'molecule-aes', moleculeName],
    queryFn: async () => {
      if (moleculeNctIds.length === 0) return []
      const result = await reportQuery<{ term: string; organ_system: string; cnt: number }>(
        aeSql, moleculeNctIds,
      )
      return result.rows
    },
    enabled: moleculeTrials.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  const sqlQueries: SqlQuery[] = aeSql ? [{ label: 'Top AEs', sql: aeSql, params: moleculeNctIds }] : []

  const getTrialCsvData = useCallback(() => ({
    columns: ['NCT ID', 'Title', 'Status', 'Phase', 'Enrollment'],
    rows: moleculeTrials.map((t) => [
      t.data.nct_id,
      t.data.brief_title || t.data.title,
      t.data.status,
      (t.data.phases || []).join(';'),
      String(t.data.enrollment || ''),
    ]),
  }), [moleculeTrials])

  const getAeCsvData = useCallback(() => ({
    columns: ['Term', 'Organ System', 'Reports'],
    rows: (topAEs || []).map((ae) => [ae.term, ae.organ_system, String(Number(ae.cnt))]),
  }), [topAEs])

  if (loadingTerm || loadingTrials) return <PageLoading message={`Loading ${moleculeName}...`} />

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/molecules" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Molecules
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-accent/10 p-3">
          <Pill className="h-6 w-6 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{termData?.label || moleculeName}</h1>
          {termData?.description && (
            <p className="mt-1 text-sm text-text-muted">{termData.description}</p>
          )}
          {termData?.aliases && termData.aliases.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="text-xs text-text-muted">Also known as:</span>
              {termData.aliases.map((a: string) => (
                <Badge key={a} variant="muted">{a}</Badge>
              ))}
            </div>
          )}
          {termData?.metadata && (
            <div className="mt-2 flex gap-3">
              {termData.metadata.modality && (
                <Badge variant="default">{String(termData.metadata.modality).replace(/_/g, ' ')}</Badge>
              )}
              {termData.metadata.target && (
                <Badge variant="accent">Target: {String(termData.metadata.target)}</Badge>
              )}
            </div>
          )}
        </div>
      </div>

      {sqlQueries.length > 0 && <SqlInspector queries={sqlQueries} />}

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Trials" value={formatNumber(moleculeTrials.length)} />
        <StatCard label="With Results" value={formatNumber(moleculeTrials.filter((t) => t.data.has_results).length)} />
        <StatCard label="Total Enrollment" value={formatNumber(moleculeTrials.reduce((s, t) => s + (t.data.enrollment || 0), 0))} />
        <StatCard label="Conditions" value={formatNumber(byCondition.length)} />
      </div>

      {/* Charts: Status + Phase */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>By Status</CardTitle></CardHeader>
          {byStatus.length > 0 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byStatus} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={75} paddingAngle={2}>
                    {byStatus.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number, n: string) => [v, formatStatus(n)]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-8 text-center text-sm text-text-muted">No data</p>}
        </Card>

        <Card>
          <CardHeader><CardTitle>By Phase</CardTitle></CardHeader>
          {byPhase.length > 0 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byPhase} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={90} tickFormatter={formatPhase} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => [v, 'Trials']} labelFormatter={formatPhase} />
                  <Bar dataKey="count" fill="#2B579A" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <p className="py-8 text-center text-sm text-text-muted">No data</p>}
        </Card>
      </div>

      {/* Therapeutic areas + conditions */}
      <div className="grid gap-6 lg:grid-cols-2">
        {byTherapeuticArea.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Therapeutic Areas</CardTitle></CardHeader>
            <div className="flex flex-wrap gap-2">
              {byTherapeuticArea.map((ta) => (
                <ChipLink key={ta.name} filterKey="therapeutic_area" filterValue={ta.name}>
                  {ta.name.replace(/_/g, ' ')} ({ta.count})
                </ChipLink>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Top Conditions</CardTitle></CardHeader>
          <div className="space-y-1">
            {byCondition.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <ChipLink filterKey="condition" filterValue={c.name} className="text-xs">
                  {c.name}
                </ChipLink>
                <span className="text-text-muted tabular-nums text-xs">{c.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* AE profile */}
      {topAEs && topAEs.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                Top Adverse Events (across {moleculeTrials.length} trials)
              </CardTitle>
              <CsvDownloadButton getData={getAeCsvData} filenamePrefix={`${moleculeName}-aes`} label="CSV" />
            </div>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-text-muted">
                  <th className="pb-2 pr-4">Term</th>
                  <th className="pb-2 pr-4">Organ System</th>
                  <th className="pb-2 text-right">Reports</th>
                </tr>
              </thead>
              <tbody>
                {topAEs.map((ae, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1.5 pr-4">{ae.term}</td>
                    <td className="py-1.5 pr-4 text-text-muted">{ae.organ_system}</td>
                    <td className="py-1.5 text-right tabular-nums">{Number(ae.cnt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Trial list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              <FlaskConical className="mr-2 inline h-4 w-4" />
              All Trials ({moleculeTrials.length})
            </CardTitle>
            <CsvDownloadButton getData={getTrialCsvData} filenamePrefix={`${moleculeName}-trials`} label="CSV" />
          </div>
        </CardHeader>
        <div className="space-y-2">
          {(showAllTrials ? moleculeTrials : moleculeTrials.slice(0, 50)).map((t) => (
            <Link
              key={t.document_id}
              to={`/trials/${t.data.nct_id}`}
              className="flex items-center justify-between rounded-md p-2 text-sm hover:bg-gray-50"
            >
              <div className="min-w-0 flex-1">
                <span className="font-mono text-xs text-primary">{t.data.nct_id}</span>
                <span className="ml-2 truncate text-text-muted">{t.data.brief_title || t.data.title}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                {(t.data.phases || []).map((p) => (
                  <Badge key={p} variant="muted">{formatPhase(p)}</Badge>
                ))}
                <Badge variant={t.data.status === 'RECRUITING' ? 'success' : 'muted'}>
                  {formatStatus(t.data.status)}
                </Badge>
              </div>
            </Link>
          ))}
          {moleculeTrials.length > 50 && (
            <button
              onClick={() => setShowAllTrials(!showAllTrials)}
              className="w-full text-center text-xs font-medium text-primary hover:underline"
            >
              {showAllTrials ? 'Show less' : `Show all ${moleculeTrials.length} trials`}
            </button>
          )}
        </div>
      </Card>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </Card>
  )
}
