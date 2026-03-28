import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Check, ArrowRight, GitCompare } from 'lucide-react'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { PageLoading } from '@/components/LoadingSpinner'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useTrialFilters } from '@/hooks/useTrialFilters'
import { useFilterToggle } from '@/hooks/useFilterNav'
import { useMoleculeStats } from '@/hooks/useMoleculeStats'
import { cn, formatNumber } from '@/lib/utils'

export function MoleculesPage() {
  const { trials: filtered, isLoading } = useFilteredTrials()
  const { filters } = useTrialFilters()
  const toggleFilter = useFilterToggle()
  const [search, setSearch] = useState('')

  const selectedMolecules = filters.molecule ?? []
  const stats = useMoleculeStats(filtered)

  // Build molecule → trial count from the filtered set
  const molecules = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of filtered) {
      for (const mol of t.data.interventions || []) {
        counts.set(mol, (counts.get(mol) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [filtered])

  const searchFiltered = useMemo(() => {
    if (!search) return molecules
    const q = search.toLowerCase()
    return molecules.filter((m) => m.name.toLowerCase().includes(q))
  }, [molecules, search])

  if (isLoading) return <PageLoading message="Loading molecules..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Molecules</h1>
        <span className="text-sm text-text-muted">
          {molecules.length} molecules across {filtered.length} trials
        </span>
      </div>

      {/* Compare button + Search */}
      {selectedMolecules.length >= 2 && (
        <Link
          to="/molecules/compare"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
        >
          <GitCompare className="h-4 w-4" />
          Compare {selectedMolecules.length} molecules
        </Link>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          placeholder="Search molecules..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-surface py-2 pl-10 pr-4 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Molecule cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {searchFiltered.map((mol) => {
          const isSelected = selectedMolecules.includes(mol.name)
          const isDimmed = selectedMolecules.length > 0 && !isSelected

          return (
            <Card
              key={mol.name}
              className={cn(
                'transition-all',
                isSelected && 'ring-2 ring-primary border-primary shadow-md',
                isDimmed && 'opacity-50',
                !isDimmed && 'hover:shadow-md',
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleFilter('molecule', mol.name)}
                    className="flex-shrink-0"
                    title={isSelected ? 'Remove from filter' : 'Add to filter'}
                  >
                    <div className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors',
                      isSelected ? 'bg-primary border-primary' : 'border-gray-300 hover:border-primary',
                    )}>
                      {isSelected && <Check className="h-3 w-3 text-white" />}
                    </div>
                  </button>
                  <Link
                    to={`/molecules/${encodeURIComponent(mol.name)}`}
                    className={cn(
                      'text-base font-semibold text-left hover:underline',
                      isDimmed ? 'text-text-muted' : 'text-primary',
                    )}
                  >
                    {mol.name}
                  </Link>
                </div>
                <Badge variant={isSelected ? 'primary' : 'accent'}>{mol.count} trials</Badge>
              </div>

              {/* Inline stats */}
              {(() => {
                const s = stats.get(mol.name)
                if (!s) return null
                return (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      {s.recruiting > 0 && <span className="text-green-600">{s.recruiting} recruiting</span>}
                      {s.completed > 0 && <span>{s.completed} completed</span>}
                      {s.totalEnrollment > 0 && <span>n={formatNumber(s.totalEnrollment)}</span>}
                    </div>
                    {s.topTAs.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.topTAs.map((ta) => (
                          <span key={ta} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                            {ta}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}

              <div className="mt-3 flex items-center gap-3">
                <Link
                  to={`/molecules/${encodeURIComponent(mol.name)}`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Details <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </Card>
          )
        })}
      </div>

      {searchFiltered.length === 0 && (
        <p className="py-12 text-center text-text-muted">
          No molecules match{search ? ` "${search}"` : ' the current filters'}.
        </p>
      )}
    </div>
  )
}
