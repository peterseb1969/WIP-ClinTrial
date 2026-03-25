import { useNavigate } from 'react-router-dom'
import {
  FlaskConical,
  Bookmark,
  ClipboardCheck,
  TrendingUp,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { ErrorMessage } from '@/components/ErrorMessage'
import { useDashboardStats } from '@/hooks/useDashboardStats'
import { useBookmarks } from '@/hooks/useBookmarks'
import { formatStatus, formatPhase } from '@/lib/trial-utils'
import { formatNumber } from '@/lib/utils'
import { useFilterNav } from '@/hooks/useFilterNav'

const PIE_COLORS = [
  '#2B579A', '#5B9BD5', '#ED7D31', '#2E8B57', '#DC3545',
  '#7C4DFF', '#00BCD4', '#FF9800', '#795548', '#607D8B',
  '#E91E63', '#9C27B0', '#3F51B5', '#009688',
]

export function DashboardPage() {
  const { data: stats, isLoading, error, refetch } = useDashboardStats()
  const { count: bookmarkCount } = useBookmarks()
  const navigate = useNavigate()
  const addFilter = useFilterNav()

  if (isLoading) return <PageLoading message="Loading dashboard..." />
  if (error) return <ErrorMessage message={error.message} onRetry={() => refetch()} />
  if (!stats) return null

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          icon={FlaskConical}
          label="Total Trials"
          value={formatNumber(stats.total)}
          onClick={() => navigate('/trials')}
        />
        <SummaryCard
          icon={Bookmark}
          label="Bookmarked"
          value={formatNumber(bookmarkCount)}
          onClick={() => navigate('/bookmarks')}
        />
        <SummaryCard
          icon={ClipboardCheck}
          label="With Results"
          value={formatNumber(stats.withResults)}
          onClick={() => addFilter('has_results', 'true')}
        />
        <SummaryCard
          icon={TrendingUp}
          label="Recruiting"
          value={formatNumber(stats.recruiting)}
          onClick={() => addFilter('status', 'RECRUITING')}
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Status donut */}
        <Card>
          <CardHeader>
            <CardTitle>By Status</CardTitle>
          </CardHeader>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.byStatus}
                  dataKey="count"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                  cursor="pointer"
                  onClick={(entry) => addFilter('status', entry.name)}
                >
                  {stats.byStatus.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number, name: string) => [value, formatStatus(name)]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {stats.byStatus.slice(0, 6).map((s, i) => (
              <button
                key={s.name}
                onClick={() => addFilter('status', s.name)}
                className="flex items-center gap-1 hover:underline"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                {formatStatus(s.name)} ({s.count})
              </button>
            ))}
          </div>
        </Card>

        {/* Phase bar chart */}
        <Card>
          <CardHeader>
            <CardTitle>By Phase</CardTitle>
          </CardHeader>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.byPhase} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={100}
                  tickFormatter={formatPhase}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip
                  formatter={(value: number) => [value, 'Trials']}
                  labelFormatter={formatPhase}
                />
                <Bar
                  dataKey="count"
                  fill="#2B579A"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(entry) => addFilter('phase', entry.name)}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top conditions */}
        <Card>
          <CardHeader>
            <CardTitle>Top Conditions</CardTitle>
          </CardHeader>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.byCondition} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={180}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip formatter={(value: number) => [value, 'Trials']} />
                <Bar
                  dataKey="count"
                  fill="#5B9BD5"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(entry) => addFilter('condition', entry.name)}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Top molecules */}
        <Card>
          <CardHeader>
            <CardTitle>Top Molecules</CardTitle>
          </CardHeader>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.byMolecule} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip formatter={(value: number) => [value, 'Trials']} />
                <Bar
                  dataKey="count"
                  fill="#ED7D31"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(entry) => addFilter('molecule', entry.name)}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  onClick,
}: {
  icon: React.ElementType
  label: string
  value: string
  onClick: () => void
}) {
  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={onClick}>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-sm text-text-muted">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </div>
    </Card>
  )
}
