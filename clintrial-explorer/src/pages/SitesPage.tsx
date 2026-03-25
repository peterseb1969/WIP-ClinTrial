import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ArrowUpDown } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useWipClient } from '@wip/react'
import { Card } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { trialsUrl, formatNumber } from '@/lib/utils'

type SortKey = 'country' | 'trials' | 'sites'

export function SitesPage() {
  const client = useWipClient()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('trials')
  const [sortAsc, setSortAsc] = useState(false)

  // Fetch all sites to get country-level stats
  const { data: siteStats, isLoading: loadingSites } = useQuery({
    queryKey: ['clintrial', 'site-stats'],
    queryFn: async () => {
      const countryMap = new Map<string, { trials: Set<string>; sites: number }>()
      let page = 1
      while (true) {
        const result = await client.documents.listDocuments({
          template_value: 'CT_TRIAL_SITE',
          status: 'active',
          page,
          page_size: 100,
        })
        for (const doc of result.items) {
          const country = String(doc.data.country || 'Unknown')
          const nctId = String(doc.data.nct_id || '')
          if (!countryMap.has(country)) {
            countryMap.set(country, { trials: new Set(), sites: 0 })
          }
          const entry = countryMap.get(country)!
          entry.trials.add(nctId)
          entry.sites++
        }
        if (page >= result.pages) break
        page++
      }
      return [...countryMap.entries()].map(([country, data]) => ({
        country,
        trialCount: data.trials.size,
        siteCount: data.sites,
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
                  <Link
                    to={trialsUrl({ country: row.country })}
                    className="font-medium text-primary hover:underline"
                  >
                    {row.country}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <Link to={trialsUrl({ country: row.country })} className="hover:underline">
                    {formatNumber(row.trialCount)}
                  </Link>
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
