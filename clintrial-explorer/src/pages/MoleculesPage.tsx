import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { PageLoading } from '@/components/LoadingSpinner'
import { useAllTrials } from '@/hooks/useAllTrials'
import { useFilterNav } from '@/hooks/useFilterNav'

export function MoleculesPage() {
  const { data: trials, isLoading: loadingTrials } = useAllTrials()
  const addFilter = useFilterNav()
  const [search, setSearch] = useState('')

  // We need to fetch molecules by terminology value. Let me use the client directly.
  // Actually, useTerms needs terminologyId. Let's find it from the terminologies list.
  // For now, we'll derive molecule info from the trial data since the terms are already
  // referenced in trial documents.

  // Build molecule → trial count map from trial data
  const moleculeStats = useMemo(() => {
    if (!trials) return new Map<string, number>()
    const counts = new Map<string, number>()
    for (const t of trials) {
      for (const mol of t.data.interventions || []) {
        counts.set(mol, (counts.get(mol) || 0) + 1)
      }
    }
    return counts
  }, [trials])

  // Get unique molecules sorted by trial count
  const molecules = useMemo(() => {
    return [...moleculeStats.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [moleculeStats])

  const filtered = useMemo(() => {
    if (!search) return molecules
    const q = search.toLowerCase()
    return molecules.filter((m) => m.name.toLowerCase().includes(q))
  }, [molecules, search])

  if (loadingTrials) return <PageLoading message="Loading molecules..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Molecules</h1>
        <span className="text-sm text-text-muted">{molecules.length} molecules</span>
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
        {filtered.map((mol) => (
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

      {filtered.length === 0 && (
        <p className="py-12 text-center text-text-muted">
          No molecules match &quot;{search}&quot;
        </p>
      )}
    </div>
  )
}
