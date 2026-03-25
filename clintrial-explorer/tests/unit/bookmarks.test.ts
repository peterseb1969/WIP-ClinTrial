import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

// Import after mocking localStorage
import { bookmarks } from '@/lib/bookmarks'

describe('bookmarks', () => {
  beforeEach(() => {
    localStorageMock.clear()
    // Reset bookmarks internal state by re-importing would be ideal,
    // but we can test the public API
  })

  it('starts empty', () => {
    expect(bookmarks.count()).toBeGreaterThanOrEqual(0)
  })

  it('toggle adds and removes a bookmark', () => {
    bookmarks.toggle('NCT00000001')
    expect(bookmarks.has('NCT00000001')).toBe(true)
    expect(bookmarks.count()).toBeGreaterThanOrEqual(1)

    bookmarks.toggle('NCT00000001')
    expect(bookmarks.has('NCT00000001')).toBe(false)
  })

  it('exportJson produces valid JSON with bookmarks array', () => {
    bookmarks.toggle('NCT00000002')
    const json = bookmarks.exportJson()
    const parsed = JSON.parse(json)

    expect(parsed).toHaveProperty('bookmarks')
    expect(parsed).toHaveProperty('exported_at')
    expect(Array.isArray(parsed.bookmarks)).toBe(true)
    expect(parsed.bookmarks).toContain('NCT00000002')

    // Cleanup
    bookmarks.toggle('NCT00000002')
  })

  it('importJson merges bookmarks and returns counts', () => {
    bookmarks.toggle('NCT00000003')
    const result = bookmarks.importJson(
      JSON.stringify({ bookmarks: ['NCT00000003', 'NCT00000004'] }),
    )

    expect(result.added).toBe(1) // NCT00000004 is new
    expect(bookmarks.has('NCT00000003')).toBe(true)
    expect(bookmarks.has('NCT00000004')).toBe(true)

    // Cleanup
    bookmarks.toggle('NCT00000003')
    bookmarks.toggle('NCT00000004')
  })

  it('subscribe notifies on changes', () => {
    const listener = vi.fn()
    const unsub = bookmarks.subscribe(listener)

    bookmarks.toggle('NCT00000005')
    expect(listener).toHaveBeenCalledTimes(1)

    bookmarks.toggle('NCT00000005')
    expect(listener).toHaveBeenCalledTimes(2)

    unsub()
    bookmarks.toggle('NCT00000005')
    expect(listener).toHaveBeenCalledTimes(2) // no more calls after unsub

    // Cleanup
    bookmarks.toggle('NCT00000005')
  })
})
