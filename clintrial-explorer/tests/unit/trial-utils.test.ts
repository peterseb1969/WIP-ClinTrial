import { describe, it, expect } from 'vitest'
import { formatStatus, formatPhase, countBy } from '@/lib/trial-utils'
import type { TrialData } from '@/hooks/useAllTrials'

describe('formatStatus', () => {
  it('converts underscore-separated to title case', () => {
    expect(formatStatus('NOT_YET_RECRUITING')).toBe('Not Yet Recruiting')
    expect(formatStatus('RECRUITING')).toBe('Recruiting')
    expect(formatStatus('COMPLETED')).toBe('Completed')
  })
})

describe('formatPhase', () => {
  it('formats phase codes to readable names', () => {
    expect(formatPhase('PHASE1')).toBe('Phase 1')
    expect(formatPhase('PHASE3')).toBe('Phase 3')
    expect(formatPhase('EARLY_PHASE1')).toBe('Early Phase 1')
    expect(formatPhase('NA')).toBe('N/A')
  })
})

describe('countBy', () => {
  const trials = [
    { data: { status: 'RECRUITING', phases: ['PHASE1', 'PHASE2'] } },
    { data: { status: 'RECRUITING', phases: ['PHASE3'] } },
    { data: { status: 'COMPLETED', phases: ['PHASE3'] } },
  ] as Array<{ data: TrialData }>

  it('counts single-value fields', () => {
    const result = countBy(trials, (d) => d.status)
    expect(result).toEqual([
      { name: 'RECRUITING', count: 2 },
      { name: 'COMPLETED', count: 1 },
    ])
  })

  it('counts array fields expanding each element', () => {
    const result = countBy(trials, (d) => d.phases)
    expect(result).toEqual([
      { name: 'PHASE3', count: 2 },
      { name: 'PHASE1', count: 1 },
      { name: 'PHASE2', count: 1 },
    ])
  })
})
