import { useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { CsvDownloadButton } from '@/components/CsvDownloadButton'
import { PageLoading } from '@/components/LoadingSpinner'
import { useAEDrillDown } from '@/hooks/useAEDrillDown'
import { trialFilters } from '@/hooks/useTrialFilters'
import { formatNumber } from '@/lib/utils'

interface AEDrillDownPanelProps {
  term: string
  aeCategory: string
  nctIds: string[]
}

export function AEDrillDownPanel({ term, aeCategory, nctIds }: AEDrillDownPanelProps) {
  const { data, isLoading } = useAEDrillDown(term, aeCategory, nctIds, true)
  const navigate = useNavigate()

  const uniqueNctIds = [...new Set(data.map((r) => r.nct_id))]

  const getCsvData = useCallback(() => ({
    columns: ['NCT ID', 'Title', 'Group/Arm', 'Affected', 'At Risk', 'Incidence %'],
    rows: data.map((r) => [
      r.nct_id, r.brief_title, r.group_title,
      String(r.num_affected), String(r.num_at_risk),
      r.incidence_pct.toFixed(1),
    ]),
  }), [data])

  const viewInTrials = () => {
    trialFilters.setMulti('nct_id', uniqueNctIds)
    navigate('/trials')
  }

  if (isLoading) return <tr><td colSpan={6}><PageLoading message="Loading details..." /></td></tr>
  if (data.length === 0) return <tr><td colSpan={6} className="px-4 py-2 text-xs text-text-muted">No arm-level data available</td></tr>

  return (
    <>
      <tr>
        <td colSpan={6} className="bg-blue-50/30 px-4 py-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">
              {term} — {uniqueNctIds.length} trials, {data.length} arm-level records
            </span>
            <div className="flex items-center gap-2">
              <CsvDownloadButton
                getData={getCsvData}
                filenamePrefix={`ae-${term.replace(/\s+/g, '-').toLowerCase()}`}
                label="CSV"
                className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-text-muted hover:bg-white"
              />
              <button
                onClick={viewInTrials}
                className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-primary hover:bg-white"
              >
                <ExternalLink className="h-3 w-3" />
                View {uniqueNctIds.length} trials
              </button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted">
                <th className="pb-1 text-left font-medium">NCT ID</th>
                <th className="pb-1 text-left font-medium">Title</th>
                <th className="pb-1 text-left font-medium">Group/Arm</th>
                <th className="pb-1 text-right font-medium">Affected</th>
                <th className="pb-1 text-right font-medium">At Risk</th>
                <th className="pb-1 text-right font-medium">Incidence</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-1 pr-2">
                    <Link to={`/trials/${row.nct_id}`} className="font-mono text-primary hover:underline">
                      {row.nct_id}
                    </Link>
                  </td>
                  <td className="py-1 pr-2 max-w-[200px] truncate" title={row.brief_title}>
                    {row.brief_title}
                  </td>
                  <td className="py-1 pr-2 text-text-muted">{row.group_title}</td>
                  <td className="py-1 text-right tabular-nums">{formatNumber(row.num_affected)}</td>
                  <td className="py-1 text-right tabular-nums">{formatNumber(row.num_at_risk)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {row.num_at_risk > 0 ? (
                      <span className={row.incidence_pct > 20 ? 'text-danger font-medium' : ''}>
                        {row.incidence_pct.toFixed(1)}%
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  )
}
