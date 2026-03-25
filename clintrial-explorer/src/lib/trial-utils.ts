import type { TrialData } from '@/hooks/useAllTrials'

/** Map raw status values to display-friendly labels and colors */
export const STATUS_COLORS: Record<string, string> = {
  RECRUITING: 'bg-success/15 text-success',
  ACTIVE_NOT_RECRUITING: 'bg-primary-light/15 text-primary',
  COMPLETED: 'bg-gray-200 text-text-muted',
  TERMINATED: 'bg-danger/15 text-danger',
  WITHDRAWN: 'bg-danger/10 text-danger',
  NOT_YET_RECRUITING: 'bg-accent/15 text-accent',
  SUSPENDED: 'bg-accent/15 text-accent',
  ENROLLING_BY_INVITATION: 'bg-success/10 text-success',
  UNKNOWN: 'bg-gray-100 text-text-muted',
  AVAILABLE: 'bg-primary-light/10 text-primary-light',
  NO_LONGER_AVAILABLE: 'bg-gray-200 text-text-muted',
  TEMPORARILY_NOT_AVAILABLE: 'bg-accent/10 text-accent',
  APPROVED_FOR_MARKETING: 'bg-success/10 text-success',
  WITHHELD: 'bg-danger/10 text-danger',
}

export function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatPhase(phase: string): string {
  return phase.replace('PHASE', 'Phase ').replace('EARLY_PHASE1', 'Early Phase 1').replace('NA', 'N/A')
}

/** Aggregate trial data by a field, returning counts sorted desc */
export function countBy<T extends TrialData>(
  trials: { data: T }[],
  accessor: (d: T) => string | string[] | undefined,
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()

  for (const trial of trials) {
    const val = accessor(trial.data)
    if (!val) continue
    const values = Array.isArray(val) ? val : [val]
    for (const v of values) {
      counts.set(v, (counts.get(v) || 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}
