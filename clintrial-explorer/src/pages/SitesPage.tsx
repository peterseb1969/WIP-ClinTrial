import { useMemo, useState } from 'react'
import { Search, ArrowUpDown, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { cn, formatNumber } from '@/lib/utils'
import { reportQuery } from '@/lib/reporting'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useTrialFilters } from '@/hooks/useTrialFilters'
import { useFilterToggle } from '@/hooks/useFilterNav'

type SortKey = 'country' | 'trials' | 'sites' | 'enrollment'

export function SitesPage() {
  const toggleFilter = useFilterToggle()
  const { trials: filtered, isLoading: loadingTrials } = useFilteredTrials()
  const { filters, hasActive } = useTrialFilters()
  const selectedCountries = filters.country ?? []
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('trials')
  const [sortAsc, setSortAsc] = useState(false)

  // Get filtered NCT IDs (excluding any country filter — we don't want to filter sites by country)
  const filteredNctIds = useMemo(
    () => new Set(filtered.map((t) => t.data.nct_id)),
    [filtered],
  )

  // Fetch all site stats server-side
  const { data: allSiteStats, isLoading: loadingSites } = useQuery({
    queryKey: ['clintrial', 'site-stats'],
    queryFn: async () => {
      const result = await reportQuery<{ country: string; nct_id: string; site_count: number }>(
        `SELECT country, nct_id, COUNT(*) as site_count
         FROM doc_ct_trial_site
         GROUP BY country, nct_id`,
        [],
        50000,
      )
      return result.rows
    },
    staleTime: 5 * 60 * 1000,
  })

  // Build enrollment lookup by NCT ID
  const enrollmentByNct = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of filtered) {
      if (t.data.enrollment) map.set(t.data.nct_id, t.data.enrollment)
    }
    return map
  }, [filtered])

  // Aggregate site stats, scoped to filtered trials
  const siteStats = useMemo(() => {
    if (!allSiteStats) return []
    const countryMap = new Map<string, { trials: Set<string>; sites: number; enrollment: number }>()

    for (const row of allSiteStats) {
      // If filters are active (other than country), only count sites for matching trials
      if (hasActive && !filteredNctIds.has(row.nct_id)) continue

      const country = row.country || 'Unknown'
      const entry = countryMap.get(country) ?? { trials: new Set<string>(), sites: 0, enrollment: 0 }
      if (!entry.trials.has(row.nct_id)) {
        entry.enrollment += enrollmentByNct.get(row.nct_id) || 0
      }
      entry.trials.add(row.nct_id)
      entry.sites += Number(row.site_count)
      countryMap.set(country, entry)
    }

    return [...countryMap.entries()].map(([country, data]) => ({
      country,
      trialCount: data.trials.size,
      siteCount: data.sites,
      enrollment: data.enrollment,
    }))
  }, [allSiteStats, filteredNctIds, hasActive, enrollmentByNct])

  const displayed = useMemo(() => {
    let result = siteStats
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((s) => s.country.toLowerCase().includes(q))
    }
    result = [...result].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'country') cmp = a.country.localeCompare(b.country)
      else if (sortKey === 'trials') cmp = a.trialCount - b.trialCount
      else if (sortKey === 'enrollment') cmp = a.enrollment - b.enrollment
      else cmp = a.siteCount - b.siteCount
      return sortAsc ? cmp : -cmp
    })
    return result
  }, [siteStats, search, sortKey, sortAsc])

  const totalSites = siteStats.reduce((s, c) => s + c.siteCount, 0)

  if (loadingTrials || loadingSites) return <PageLoading message="Loading sites data..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sites</h1>
        <span className="text-sm text-text-muted">
          {formatNumber(totalSites)} sites · {siteStats.length} countries
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
              <SortHeader label="Enrollment" sortKey="enrollment" current={sortKey} asc={sortAsc} onSort={(k) => {
                if (sortKey === k) setSortAsc(!sortAsc)
                else { setSortKey(k); setSortAsc(false) }
              }} align="right" />
              <th className="px-4 py-2.5 font-medium text-text-muted text-right w-10" />
            </tr>
          </thead>
          <tbody>
            {displayed.map((row) => {
              const isSelected = selectedCountries.includes(row.country)
              const isDimmed = selectedCountries.length > 0 && !isSelected

              return (
                <tr
                  key={row.country}
                  className={cn(
                    'border-b border-gray-100',
                    isSelected && 'bg-primary/5 font-medium',
                    isDimmed && 'opacity-50',
                    !isDimmed && 'hover:bg-gray-50/50',
                  )}
                >
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => toggleFilter('country', row.country)}
                      className={cn(
                        'font-medium hover:underline',
                        isSelected ? 'text-primary' : isDimmed ? 'text-text-muted' : 'text-primary',
                      )}
                    >
                      {isSelected ? `\u2713 ${row.country}` : row.country}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <button
                      onClick={() => toggleFilter('country', row.country)}
                      className="hover:underline"
                    >
                      {formatNumber(row.trialCount)}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(row.siteCount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-text-muted">
                    {row.enrollment > 0 ? formatNumber(row.enrollment) : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      to={`/trials`}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!selectedCountries.includes(row.country)) {
                          toggleFilter('country', row.country)
                        }
                      }}
                      className="text-text-muted hover:text-primary"
                      title={`View trials in ${row.country}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
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
