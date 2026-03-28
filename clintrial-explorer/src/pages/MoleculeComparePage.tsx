import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Pill, X } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { PageLoading } from '@/components/LoadingSpinner'
import { useAllTrials, type TrialDocument } from '@/hooks/useAllTrials'
import { useTrialFilters } from '@/hooks/useTrialFilters'
import { useFilterToggle } from '@/hooks/useFilterNav'
import { useMoleculeComparisonAEs } from '@/hooks/useMoleculeComparison'
import { formatNumber } from '@/lib/utils'
import { formatPhase, countBy } from '@/lib/trial-utils'

export function MoleculeComparePage() {
  const { filters } = useTrialFilters()
  const toggleFilter = useFilterToggle()
  const selectedMolecules = filters.molecule ?? []
  const { data: allTrials, isLoading: loadingTrials } = useAllTrials()
  const { data: aeData, isLoading: loadingAEs } = useMoleculeComparisonAEs(selectedMolecules)

  // Per-molecule trial stats
  const moleculeStats = useMemo(() => {
    if (!allTrials) return new Map<string, TrialDocument[]>()
    const map = new Map<string, TrialDocument[]>()
    for (const mol of selectedMolecules) {
      map.set(mol, allTrials.filter((t) => t.data.interventions?.includes(mol)))
    }
    return map
  }, [allTrials, selectedMolecules])

  // Build AE comparison matrix
  const aeMatrix = useMemo(() => {
    if (aeData.length === 0) return null

    // Top AE terms (union of top 15 per molecule)
    const perMoleculeTop = new Map<string, Map<string, number>>()
    for (const r of aeData) {
      if (!perMoleculeTop.has(r.molecule)) perMoleculeTop.set(r.molecule, new Map())
      const m = perMoleculeTop.get(r.molecule)!
      if (m.size < 15) m.set(r.term, r.trial_count)
    }
    const allTerms = new Set<string>()
    for (const m of perMoleculeTop.values()) {
      for (const t of m.keys()) allTerms.add(t)
    }

    // Sort by total count across molecules
    const termTotals = new Map<string, number>()
    for (const r of aeData) {
      if (allTerms.has(r.term)) {
        termTotals.set(r.term, (termTotals.get(r.term) || 0) + r.trial_count)
      }
    }
    const terms = [...allTerms].sort((a, b) => (termTotals.get(b) || 0) - (termTotals.get(a) || 0))

    // Build matrix
    const matrix = new Map<string, Map<string, number>>()
    for (const r of aeData) {
      if (!allTerms.has(r.term)) continue
      if (!matrix.has(r.term)) matrix.set(r.term, new Map())
      const row = matrix.get(r.term)!
      row.set(r.molecule, (row.get(r.molecule) || 0) + r.trial_count)
    }

    let maxCount = 0
    for (const row of matrix.values()) {
      for (const v of row.values()) {
        if (v > maxCount) maxCount = v
      }
    }

    return { terms, matrix, maxCount }
  }, [aeData])

  if (selectedMolecules.length < 2) {
    return (
      <div className="space-y-6">
        <Link to="/molecules" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Molecules
        </Link>
        <Card>
          <div className="py-12 text-center">
            <Pill className="mx-auto h-8 w-8 text-text-muted" />
            <p className="mt-3 text-text-muted">Select 2 or more molecules to compare.</p>
            <Link to="/molecules" className="mt-2 inline-block text-sm text-primary hover:underline">
              Go to Molecules page
            </Link>
          </div>
        </Card>
      </div>
    )
  }

  if (loadingTrials) return <PageLoading message="Loading comparison..." />

  return (
    <div className="space-y-6">
      <Link to="/molecules" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Molecules
      </Link>

      {/* Header with removable molecule chips */}
      <div>
        <h1 className="text-2xl font-bold">Molecule Comparison</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedMolecules.map((mol) => (
            <button
              key={mol}
              onClick={() => toggleFilter('molecule', mol)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary hover:bg-primary/20"
            >
              {mol.replace(/_/g, ' ')}
              <X className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {/* Summary comparison table */}
      <Card>
        <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-text-muted">
                <th className="pb-2 pr-4">Molecule</th>
                <th className="pb-2 pr-4 text-right">Trials</th>
                <th className="pb-2 pr-4 text-right">Recruiting</th>
                <th className="pb-2 pr-4 text-right">Completed</th>
                <th className="pb-2 pr-4 text-right">Enrollment</th>
                <th className="pb-2 text-right">With Results</th>
              </tr>
            </thead>
            <tbody>
              {selectedMolecules.map((mol) => {
                const trials = moleculeStats.get(mol) || []
                const byStatus = countBy(trials, (d) => d.status)
                const recruiting = byStatus.find((s) => s.name === 'RECRUITING')?.count || 0
                const completed = byStatus.find((s) => s.name === 'COMPLETED')?.count || 0
                const enrollment = trials.reduce((s, t) => s + (t.data.enrollment || 0), 0)
                const withResults = trials.filter((t) => t.data.has_results).length

                return (
                  <tr key={mol} className="border-b border-gray-50">
                    <td className="py-2 pr-4">
                      <Link to={`/molecules/${encodeURIComponent(mol)}`} className="font-medium text-primary hover:underline">
                        {mol.replace(/_/g, ' ')}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{trials.length}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-green-600">{recruiting}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{completed}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatNumber(enrollment)}</td>
                    <td className="py-2 text-right tabular-nums">{withResults}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Phase comparison */}
      <Card>
        <CardHeader><CardTitle>Phase Distribution</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-text-muted">
                <th className="pb-2 pr-4">Molecule</th>
                {['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4'].map((p) => (
                  <th key={p} className="pb-2 px-2 text-center">{formatPhase(p)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selectedMolecules.map((mol) => {
                const trials = moleculeStats.get(mol) || []
                const phaseCounts = new Map<string, number>()
                for (const t of trials) {
                  for (const p of t.data.phases || []) {
                    phaseCounts.set(p, (phaseCounts.get(p) || 0) + 1)
                  }
                }
                return (
                  <tr key={mol} className="border-b border-gray-50">
                    <td className="py-2 pr-4 font-medium">{mol.replace(/_/g, ' ')}</td>
                    {['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4'].map((p) => (
                      <td key={p} className="py-2 px-2 text-center tabular-nums">
                        {phaseCounts.get(p) || <span className="text-gray-300">-</span>}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* AE comparison matrix */}
      {loadingAEs ? (
        <Card><p className="py-8 text-center text-sm text-text-muted">Loading AE comparison...</p></Card>
      ) : aeMatrix && aeMatrix.terms.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Adverse Event Comparison (top terms per molecule)</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-text-muted">
                  <th className="pb-2 pr-3 text-left sticky left-0 bg-surface min-w-[180px]">AE Term</th>
                  {selectedMolecules.map((mol) => (
                    <th key={mol} className="pb-2 px-2 text-center min-w-[80px]">
                      <span className="block truncate max-w-[100px]" title={mol.replace(/_/g, ' ')}>
                        {mol.replace(/_/g, ' ')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {aeMatrix.terms.map((term) => (
                  <tr key={term} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-3 font-medium sticky left-0 bg-surface">{term}</td>
                    {selectedMolecules.map((mol) => {
                      const count = aeMatrix.matrix.get(term)?.get(mol) ?? 0
                      const intensity = aeMatrix.maxCount > 0 ? count / aeMatrix.maxCount : 0
                      return (
                        <td
                          key={mol}
                          className="py-1.5 px-2 text-center tabular-nums"
                          style={count > 0 ? {
                            backgroundColor: `rgba(220, 53, 69, ${0.08 + intensity * 0.35})`,
                          } : undefined}
                        >
                          {count > 0 ? count : <span className="text-gray-300">-</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <p className="py-8 text-center text-sm text-text-muted">No AE data available for the selected molecules.</p>
        </Card>
      )}
    </div>
  )
}
