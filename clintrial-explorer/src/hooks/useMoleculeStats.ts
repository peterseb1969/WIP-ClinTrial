import { useMemo } from 'react'

interface TrialDoc {
  data: {
    nct_id: string
    status: string
    enrollment?: number
    interventions?: string[]
    therapeutic_areas?: string[]
    has_results: boolean
  }
}

export interface MoleculeStats {
  trialCount: number
  recruiting: number
  completed: number
  totalEnrollment: number
  hasResults: number
  topTAs: string[]
}

/** Derive per-molecule summary stats from the filtered trial list. No SQL needed. */
export function useMoleculeStats(trials: TrialDoc[]): Map<string, MoleculeStats> {
  return useMemo(() => {
    const map = new Map<string, {
      trials: number
      recruiting: number
      completed: number
      enrollment: number
      hasResults: number
      tas: Map<string, number>
    }>()

    for (const t of trials) {
      const d = t.data
      for (const mol of d.interventions || []) {
        let entry = map.get(mol)
        if (!entry) {
          entry = { trials: 0, recruiting: 0, completed: 0, enrollment: 0, hasResults: 0, tas: new Map() }
          map.set(mol, entry)
        }
        entry.trials++
        if (d.status === 'RECRUITING') entry.recruiting++
        if (d.status === 'COMPLETED') entry.completed++
        entry.enrollment += d.enrollment || 0
        if (d.has_results) entry.hasResults++
        for (const ta of d.therapeutic_areas || []) {
          entry.tas.set(ta, (entry.tas.get(ta) || 0) + 1)
        }
      }
    }

    const result = new Map<string, MoleculeStats>()
    for (const [mol, entry] of map) {
      const topTAs = [...entry.tas.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([ta]) => ta.replace(/_/g, ' '))
      result.set(mol, {
        trialCount: entry.trials,
        recruiting: entry.recruiting,
        completed: entry.completed,
        totalEnrollment: entry.enrollment,
        hasResults: entry.hasResults,
        topTAs,
      })
    }
    return result
  }, [trials])
}
