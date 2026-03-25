import { useMemo, useState } from 'react'
import { Search, ArrowUpDown } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import { reportQuery } from '@/lib/reporting'
import { useFilterNav } from '@/hooks/useFilterNav'

type SortKey = 'country' | 'trials' | 'sites'

export function SitesPage() {
  const addFilter = useFilterNav()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('trials')
  const [sortAsc, setSortAsc] = useState(false)

  // Single SQL query aggregates 25K+ sites server-side
  const { data: siteStats, isLoading: loadingSites } = useQuery({
    queryKey: ['clintrial', 'site-stats'],
    queryFn: async () => {
      const result = await reportQuery<{ country: string; trial_count: number; site_count: number }>(
        `SELECT country, COUNT(DISTINCT nct_id) as trial_count, COUNT(*) as site_count
         FROM doc_ct_trial_site
         GROUP BY country
         ORDER BY trial_count DESC`,
      )
      return result.rows.map((r) => ({
        country: r.country || 'Unknown',
        trialCount: Number(r.trial_count),
        siteCount: Number(r.site_count),
      }))
    },
    staleTime: 5 * 60 * 1000,
  })

  const filtered = useMemo(() => {
    if (!siteStats) return []
    let result = siteStats
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((s) => s.country.toLowerCase().includes(q))
    }
    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'country') cmp = a.country.localeCompare(b.country)
      else if (sortKey === 'trials') cmp = a.trialCount - b.trialCount
      else cmp = a.siteCount - b.siteCount
      return sortAsc ? cmp : -cmp
    })
    return result
  }, [siteStats, search, sortKey, sortAsc])

  const totalSites = siteStats?.reduce((s, c) => s + c.siteCount, 0) ?? 0

  if (loadingSites) return <PageLoading message="Loading sites data..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sites</h1>
        <span className="text-sm text-text-muted">
          {formatNumber(totalSites)} sites · {siteStats?.length ?? 0} countries
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Search countries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-surface py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/50">
              <SortHeader label="Country" sortKey="country" current={sortKey} asc={sortAsc} onSort={(k) => {
                if (sortKey === k) setSortAsc(!sortAsc)
                else { setSortKey(k); setSortAsc(false) }
              }} />
              <SortHeader label="Trials" sortKey="trials" current={sortKey} asc={sortAsc} onSort={(k) => {
                if (sortKey === k) setSortAsc(!sortAsc)
                else { setSortKey(k); setSortAsc(false) }
              }} align="right" />
              <SortHeader label="Sites" sortKey="sites" current={sortKey} asc={sortAsc} onSort={(k) => {
                if (sortKey === k) setSortAsc(!sortAsc)
                else { setSortKey(k); setSortAsc(false) }
              }} align="right" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.country} className="border-b border-gray-100 hover:bg-gray-50/50">
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => addFilter('country', row.country)}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.country}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <button
                    onClick={() => addFilter('country', row.country)}
                    className="hover:underline"
                  >
                    {formatNumber(row.trialCount)}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(row.siteCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

function SortHeader({
  label,
  sortKey,
  current,
  asc,
  onSort,
  align = 'left',
}: {
  label: string
  sortKey: SortKey
  current: SortKey
  asc: boolean
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`cursor-pointer px-4 py-2.5 font-medium text-text-muted select-none ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {current === sortKey && (
          <ArrowUpDown className="h-3 w-3" style={{ transform: asc ? 'scaleY(-1)' : undefined }} />
        )}
      </span>
    </th>
  )
}
