import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, Check, ArrowRight } from 'lucide-react'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { PageLoading } from '@/components/LoadingSpinner'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useTrialFilters } from '@/hooks/useTrialFilters'
import { useFilterToggle } from '@/hooks/useFilterNav'
import { cn } from '@/lib/utils'

export function MoleculesPage() {
  const { trials: filtered, isLoading } = useFilteredTrials()
  const { filters } = useTrialFilters()
  const toggleFilter = useFilterToggle()
  const [search, setSearch] = useState('')

  const selectedMolecules = filters.molecule ?? []

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

      {/* Search */}
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
