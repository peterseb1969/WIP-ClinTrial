import { describe, it, expect } from 'vitest'
import { trialsUrl, formatNumber } from '@/lib/utils'

describe('trialsUrl', () => {
  it('builds URL with query params', () => {
    expect(trialsUrl({ status: 'RECRUITING' })).toBe('/trials?status=RECRUITING')
    expect(trialsUrl({ phase: 'PHASE3', molecule: 'atezolizumab' })).toBe(
      '/trials?phase=PHASE3&molecule=atezolizumab',
    )
  })
})

describe('formatNumber', () => {
  it('formats numbers with locale separators', () => {
    const result = formatNumber(1234)
    // Accept any locale formatting
    expect(result).toMatch(/1.?234/)
  })
})
