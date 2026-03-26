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
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function formatPhase(phase: string): string {
  if (phase === 'NA') return 'N/A'
  if (phase === 'EARLY_PHASE1') return 'Early Phase 1'
  return phase.replace(/^PHASE(\d)$/, 'Phase $1')
}

/**
 * Normalize a condition string for grouping: lowercase, strip qualifiers,
 * remove apostrophes/hyphens/punctuation, collapse whitespace.
 */
export function normalizeCondition(raw: string): string {
  let s = raw.toLowerCase()
  // Remove common qualifier prefixes that create false splits
  s = s.replace(/^(moderately to severely active|locally advanced or metastatic|advanced or metastatic|relapsed or refractory|recurrent|metastatic|advanced|refractory|extensive[ -]stage?|stage \w+|severe|moderate|mild|acquired|concomitant \w+ and)\s+/i, '')
  s = s
    .replace(/\uff0c/g, ',')        // Unicode fullwidth comma → ASCII
    .replace(/['''\u2019]/g, '')     // Remove all apostrophe variants
    .replace(/[(),]/g, ' ')         // Parens/commas to spaces
    .replace(/-/g, ' ')             // Hyphens to spaces
    .replace(/\s+/g, ' ')          // Collapse whitespace
    .trim()
  // Remove trailing qualifiers
  s = s.replace(/\s+(ajcc v\d+|american joint committee.*|patients?|recurrent|metastatic|stage \w+|with inhibitor|without inhibitor|acquired)$/i, '')
  // British → American spelling
  s = s.replace(/\bhaemophilia/g, 'hemophilia')
  s = s.replace(/\btumour/g, 'tumor')
  s = s.replace(/\bleukaemia/g, 'leukemia')
  s = s.replace(/\banaemia/g, 'anemia')
  s = s.replace(/\boesophag/g, 'esophag')
  // Normalize possessive-style variants: "crohn disease" → "crohns disease"
  s = s.replace(/\b(crohn|hodgkin|parkinson|alzheimer)\b(?!s)/g, '$1s')
  return s
}

/**
 * Group conditions by normalized form, returning the most common spelling
 * as the display name with the combined count.
 */
export function deduplicateConditions(
  conditions: Array<{ name: string; count: number }>,
): Array<{ name: string; count: number }> {
  const groups = new Map<string, { bestName: string; bestCount: number; totalCount: number }>()

  for (const { name, count } of conditions) {
    const key = normalizeCondition(name)
    const existing = groups.get(key)
    if (existing) {
      existing.totalCount += count
      // Keep the most common spelling as display name
      if (count > existing.bestCount) {
        existing.bestName = name
        existing.bestCount = count
      }
    } else {
      groups.set(key, { bestName: name, bestCount: count, totalCount: count })
    }
  }

  return [...groups.values()]
    .map(({ bestName, totalCount }) => ({ name: bestName, count: totalCount }))
    .sort((a, b) => b.count - a.count)
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
