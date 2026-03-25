import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { PageLoading } from '@/components/LoadingSpinner'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useFilterNav } from '@/hooks/useFilterNav'

export function MoleculesPage() {
  const { trials: filtered, isLoading } = useFilteredTrials()
  const addFilter = useFilterNav()
  const [search, setSearch] = useState('')

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
        {searchFiltered.map((mol) => (
          <Card key={mol.name} className="hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <button
                  onClick={() => addFilter('molecule', mol.name)}
                  className="text-base font-semibold text-primary hover:underline text-left"
                >
                  {mol.name}
                </button>
              </div>
              <Badge variant="accent">{mol.count} trials</Badge>
            </div>

            <div className="mt-3">
              <button
                onClick={() => addFilter('molecule', mol.name)}
                className="text-xs text-primary hover:underline"
              >
                View all trials →
              </button>
            </div>
          </Card>
        ))}
      </div>

      {searchFiltered.length === 0 && (
        <p className="py-12 text-center text-text-muted">
          No molecules match{search ? ` "${search}"` : ' the current filters'}.
        </p>
      )}
    </div>
  )
}
