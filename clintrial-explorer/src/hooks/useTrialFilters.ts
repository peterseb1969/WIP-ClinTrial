import { useSyncExternalStore, useCallback } from 'react'

export type FilterKey =
  | 'status'
  | 'phase'
  | 'study_type'
  | 'therapeutic_area'
  | 'molecule'
  | 'condition'
  | 'sponsor'
  | 'has_results'
  | 'bookmarked'
  | 'search'
  | 'country'

type Filters = Partial<Record<FilterKey, string>>

const STORAGE_KEY = 'clintrial-trial-filters'

function load(): Filters {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function save(filters: Filters): void {
  const clean = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''),
  )
  if (Object.keys(clean).length === 0) {
    sessionStorage.removeItem(STORAGE_KEY)
  } else {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  }
}

let listeners: Array<() => void> = []
let snapshot: Filters = load()

function notify() {
  listeners.forEach((l) => l())
}

export const trialFilters = {
  getSnapshot(): Filters {
    return snapshot
  },

  subscribe(listener: () => void): () => void {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((l) => l !== listener)
    }
  },

  set(key: FilterKey, value: string | null): void {
    const next = { ...snapshot }
    if (value) {
      next[key] = value
    } else {
      delete next[key]
    }
    snapshot = next
    save(snapshot)
    notify()
  },

  clearAll(): void {
    snapshot = {}
    save(snapshot)
    notify()
  },

  get hasActive(): boolean {
    return Object.keys(snapshot).filter((k) => k !== 'search').length > 0
  },
}

export function useTrialFilters() {
  const filters = useSyncExternalStore(
    trialFilters.subscribe,
    trialFilters.getSnapshot,
  )

  const set = useCallback(
    (key: FilterKey, value: string | null) => trialFilters.set(key, value),
    [],
  )

  const clearAll = useCallback(() => trialFilters.clearAll(), [])

  const nonSearchFilters = Object.entries(filters).filter(
    ([k]) => k !== 'search',
  )

  return {
    filters,
    set,
    clearAll,
    hasActive: nonSearchFilters.length > 0,
    activeEntries: nonSearchFilters as Array<[FilterKey, string]>,
  }
}
