import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ExternalLink,
  FileText,
  Download,
  Users,
  MapPin,
  AlertTriangle,
  BarChart3,
  ClipboardList,
} from 'lucide-react'
import { useWipClient } from '@wip/react'
import { Badge } from '@/components/Badge'
import { ChipLink } from '@/components/ChipLink'
import { Card } from '@/components/Card'
import { StatusBadge } from '@/components/StatusBadge'
import { BookmarkButton } from '@/components/BookmarkButton'
import { PageLoading } from '@/components/LoadingSpinner'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { ErrorMessage } from '@/components/ErrorMessage'
import {
  useTrial,
  useTrialOutcomes,
  useTrialSites,
  useTrialAEs,
  useTrialBaselines,
  useTrialFiles,
} from '@/hooks/useTrialDetail'
import { formatPhase } from '@/lib/trial-utils'
import { trialsUrl, formatNumber } from '@/lib/utils'

type TabId = 'overview' | 'outcomes' | 'sites' | 'aes' | 'baseline' | 'documents'

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: 'Overview', icon: ClipboardList },
  { id: 'outcomes', label: 'Outcomes', icon: BarChart3 },
  { id: 'sites', label: 'Sites', icon: MapPin },
  { id: 'aes', label: 'Adverse Events', icon: AlertTriangle },
  { id: 'baseline', label: 'Baseline', icon: Users },
  { id: 'documents', label: 'Documents', icon: FileText },
]

export function TrialDetailPage() {
  const { nctId } = useParams<{ nctId: string }>()
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const { data: trial, isLoading, error } = useTrial(nctId || '')

  if (isLoading) return <PageLoading message={`Loading ${nctId}...`} />
  if (error) return <ErrorMessage message={error.message} />
  if (!trial) return <ErrorMessage title="Not Found" message={`Trial ${nctId} not found.`} />

  const d = trial.data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-start gap-3">
          <BookmarkButton nctId={d.nct_id} />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold">{d.nct_id}</h1>
              <StatusBadge status={d.status} />
              {(d.phases || []).map((p) => (
                <ChipLink key={p} to={trialsUrl({ phase: p })}>
                  {formatPhase(p)}
                </ChipLink>
              ))}
              {d.acronym && <Badge variant="muted">{d.acronym}</Badge>}
            </div>
            <h2 className="mt-1 text-base text-text-muted">{d.brief_title || d.title}</h2>
          </div>
        </div>

        {/* Clickable metadata chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          <ChipLink to={trialsUrl({ sponsor: d.sponsor })} variant="primary">
            {d.sponsor}
          </ChipLink>
          <ChipLink to={trialsUrl({ study_type: d.study_type })}>
            {d.study_type.replace(/_/g, ' ')}
          </ChipLink>
          {(d.interventions || []).map((m) => (
            <ChipLink key={m} to={trialsUrl({ molecule: m })} variant="accent">
              {m}
            </ChipLink>
          ))}
          {(d.therapeutic_areas || []).map((ta) => (
            <ChipLink key={ta} to={trialsUrl({ therapeutic_area: ta })}>
              {ta}
            </ChipLink>
          ))}
          {d.ctgov_url && (
            <a
              href={d.ctgov_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-text-muted hover:bg-gray-200"
            >
              ClinicalTrials.gov <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                activeTab === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:border-gray-300 hover:text-text'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab data={d} />}
      {activeTab === 'outcomes' && <OutcomesTab nctId={d.nct_id} />}
      {activeTab === 'sites' && <SitesTab nctId={d.nct_id} />}
      {activeTab === 'aes' && <AEsTab nctId={d.nct_id} />}
      {activeTab === 'baseline' && <BaselineTab nctId={d.nct_id} />}
      {activeTab === 'documents' && <DocumentsTab trialDocId={trial.document_id} />}
    </div>
  )
}

function OverviewTab({ data: d }: { data: Record<string, unknown> }) {
  const summary = String(d.brief_summary || '')
  const enrollment = d.enrollment as number | undefined
  const startDate = String(d.start_date || '—')
  const primaryComp = String(d.primary_completion_date || '—')
  const completionDate = String(d.completion_date || '—')
  const sex = String(d.sex || '—')
  const minAge = String(d.minimum_age || '')
  const maxAge = String(d.maximum_age || '')
  const healthyVol = String(d.healthy_volunteers || '—')
  const conditions = (d.conditions as string[] | undefined) || []
  const eligibility = String(d.eligibility_criteria || '')

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <h3 className="mb-3 font-semibold">Summary</h3>
        <p className="text-sm leading-relaxed text-text-muted">{summary || 'No summary available.'}</p>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">Study Details</h3>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-text-muted">Enrollment</dt>
          <dd className="font-medium">{enrollment ? formatNumber(enrollment) : '—'}</dd>
          <dt className="text-text-muted">Start Date</dt>
          <dd>{startDate}</dd>
          <dt className="text-text-muted">Primary Completion</dt>
          <dd>{primaryComp}</dd>
          <dt className="text-text-muted">Completion</dt>
          <dd>{completionDate}</dd>
          <dt className="text-text-muted">Sex</dt>
          <dd>{sex}</dd>
          <dt className="text-text-muted">Age Range</dt>
          <dd>{minAge || maxAge ? `${minAge || 'N/A'} – ${maxAge || 'N/A'}` : '—'}</dd>
          <dt className="text-text-muted">Healthy Volunteers</dt>
          <dd>{healthyVol}</dd>
          <dt className="text-text-muted">Has Results</dt>
          <dd>{d.has_results ? 'Yes' : 'No'}</dd>
        </dl>
      </Card>

      {conditions.length > 0 && (
        <Card>
          <h3 className="mb-3 font-semibold">Conditions</h3>
          <div className="flex flex-wrap gap-2">
            {conditions.map((c) => (
              <ChipLink key={c} to={trialsUrl({ condition: c })}>
                {c}
              </ChipLink>
            ))}
          </div>
        </Card>
      )}

      {eligibility && (
        <Card className="lg:col-span-2">
          <h3 className="mb-3 font-semibold">Eligibility Criteria</h3>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted font-sans">
            {eligibility}
          </pre>
        </Card>
      )}
    </div>
  )
}

function OutcomesTab({ nctId }: { nctId: string }) {
  const { data: outcomes, isLoading } = useTrialOutcomes(nctId)
  if (isLoading) return <LoadingSpinner />
  if (!outcomes || outcomes.length === 0)
    return <p className="py-8 text-center text-text-muted">No outcome measures recorded.</p>

  const grouped = groupBy(outcomes, (o) => (o.data.outcome_type as string) || 'UNKNOWN')
  const typeOrder = ['PRIMARY', 'SECONDARY', 'OTHER']

  return (
    <div className="space-y-6">
      {typeOrder.map((type) => {
        const items = grouped[type]
        if (!items) return null
        return (
          <Card key={type}>
            <h3 className="mb-3 font-semibold">{type.charAt(0) + type.slice(1).toLowerCase()} Outcomes ({items.length})</h3>
            <div className="space-y-3">
              {items
                .sort((a, b) => ((a.data.sequence as number) || 0) - ((b.data.sequence as number) || 0))
                .map((o) => (
                  <div key={o.document_id} className="border-l-2 border-primary/20 pl-3">
                    <p className="text-sm font-medium">{String(o.data.measure || '')}</p>
                    {o.data.time_frame ? (
                      <p className="mt-0.5 text-xs text-text-muted">Time frame: {String(o.data.time_frame)}</p>
                    ) : null}
                    {o.data.description ? (
                      <p className="mt-1 text-xs text-text-muted">{String(o.data.description)}</p>
                    ) : null}
                  </div>
                ))}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function SitesTab({ nctId }: { nctId: string }) {
  const { data: sites, isLoading } = useTrialSites(nctId)
  if (isLoading) return <LoadingSpinner />
  if (!sites || sites.length === 0)
    return <p className="py-8 text-center text-text-muted">No site information available.</p>

  // Group by country
  const byCountry = groupBy(sites, (s) => (s.data.country as string) || 'Unknown')
  const countries = Object.entries(byCountry).sort((a, b) => b[1].length - a[1].length)

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{sites.length} sites across {countries.length} countries</p>
      {countries.map(([country, countrySites]) => (
        <Card key={country}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              <Link
                to={trialsUrl({ country })}
                className="hover:text-primary hover:underline"
              >
                {country}
              </Link>
            </h3>
            <Badge variant="muted">{countrySites.length} sites</Badge>
          </div>
          <div className="mt-2 space-y-1">
            {countrySites.map((s) => (
              <div key={s.document_id} className="flex justify-between text-sm">
                <span>{s.data.facility as string}</span>
                <span className="text-text-muted">{s.data.city as string}{s.data.zip ? `, ${s.data.zip}` : ''}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

function AEsTab({ nctId }: { nctId: string }) {
  const { data: aes, isLoading } = useTrialAEs(nctId)
  const [showSerious, setShowSerious] = useState(true)

  if (isLoading) return <LoadingSpinner />
  if (!aes || aes.length === 0)
    return <p className="py-8 text-center text-text-muted">No adverse event data available.</p>

  const serious = aes.filter((a) => a.data.ae_category === 'SERIOUS')
  const other = aes.filter((a) => a.data.ae_category === 'OTHER')
  const currentAEs = showSerious ? serious : other

  // Group by organ system
  const byOrgan = groupBy(currentAEs, (a) => (a.data.organ_system as string) || 'Unknown')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowSerious(true)}
          className={`rounded-md px-3 py-1 text-sm font-medium ${showSerious ? 'bg-danger/10 text-danger' : 'text-text-muted'}`}
        >
          Serious ({serious.length})
        </button>
        <button
          onClick={() => setShowSerious(false)}
          className={`rounded-md px-3 py-1 text-sm font-medium ${!showSerious ? 'bg-primary/10 text-primary' : 'text-text-muted'}`}
        >
          Other ({other.length})
        </button>
      </div>

      {Object.entries(byOrgan)
        .sort((a, b) => b[1].length - a[1].length)
        .map(([organ, organAEs]) => (
          <Card key={organ}>
            <h3 className="mb-2 font-semibold">{organ} ({organAEs.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-text-muted">
                    <th className="pb-1 pr-4">Term</th>
                    {(organAEs[0]?.data.stats as Array<{ group_title: string }> || []).map((g) => (
                      <th key={g.group_title} className="pb-1 pr-3 text-right">{g.group_title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {organAEs.map((ae) => (
                    <tr key={ae.document_id} className="border-b border-gray-50">
                      <td className="py-1 pr-4">{ae.data.term as string}</td>
                      {(ae.data.stats as Array<{ group_title: string; num_affected: number; num_at_risk: number }> || []).map((s) => (
                        <td key={s.group_title} className="py-1 pr-3 text-right tabular-nums">
                          {s.num_affected}/{s.num_at_risk}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
    </div>
  )
}

function BaselineTab({ nctId }: { nctId: string }) {
  const { data: baselines, isLoading } = useTrialBaselines(nctId)

  if (isLoading) return <LoadingSpinner />
  if (!baselines || baselines.length === 0)
    return <p className="py-8 text-center text-text-muted">No baseline data available.</p>

  return (
    <div className="space-y-4">
      {baselines.map((b) => (
        <Card key={b.document_id}>
          <h3 className="mb-2 font-semibold text-sm">{String(b.data.measure_title || '')}</h3>
          {b.data.param_type ? (
            <p className="mb-2 text-xs text-text-muted">
              {String(b.data.param_type)}
              {b.data.unit_of_measure ? ` (${String(b.data.unit_of_measure)})` : ''}
            </p>
          ) : null}
          {b.data.categories ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-text-muted">
                    <th className="pb-1 pr-4">Category</th>
                    {((b.data.categories as Array<{ measurements: Array<{ group_title: string }> }>)[0]?.measurements || []).map((m) => (
                      <th key={m.group_title} className="pb-1 pr-3 text-right">{m.group_title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(b.data.categories as Array<{ title: string; measurements: Array<{ group_title: string; value: string }> }>).map((cat) => (
                    <tr key={cat.title} className="border-b border-gray-50">
                      <td className="py-1 pr-4">{cat.title}</td>
                      {cat.measurements.map((m) => (
                        <td key={m.group_title} className="py-1 pr-3 text-right tabular-nums">
                          {m.value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  )
}

function DocumentsTab({ trialDocId }: { trialDocId: string }) {
  const { data: files, isLoading } = useTrialFiles(trialDocId)
  const client = useWipClient()

  const handleDownload = async (fileId: string, filename: string) => {
    try {
      const { download_url } = await client.files.getDownloadUrl(fileId)
      window.open(download_url, '_blank')
    } catch {
      // Fallback: direct download
      try {
        const blob = await client.files.downloadFileContent(fileId)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
      } catch (err) {
        console.error('Download failed:', err)
      }
    }
  }

  if (isLoading) return <LoadingSpinner />
  if (!files || files.length === 0)
    return <p className="py-8 text-center text-text-muted">No documents attached to this trial.</p>

  return (
    <Card>
      <h3 className="mb-3 font-semibold">Trial Documents</h3>
      <div className="space-y-2">
        {files.map((f) => {
          if (!f) return null
          return (
            <div key={f.file_id} className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-danger" />
                <div>
                  <p className="text-sm font-medium">{f.filename}</p>
                  <p className="text-xs text-text-muted">
                    {f.content_type} · {f.size_bytes ? `${Math.round(f.size_bytes / 1024)} KB` : 'Unknown size'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleDownload(f.file_id, f.filename)}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/5"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/** Group array items by a key function */
function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of items) {
    const key = keyFn(item)
    if (!result[key]) result[key] = []
    result[key].push(item)
  }
  return result
}
