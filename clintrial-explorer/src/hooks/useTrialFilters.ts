import { useSyncExternalStore, useCallback } from 'react'

/** Filter keys that support multi-select (arrays) */
export type MultiFilterKey =
  | 'status'
  | 'phase'
  | 'study_type'
  | 'therapeutic_area'
  | 'molecule'
  | 'condition'
  | 'sponsor'
  | 'country'

/** Filter keys that are single-value toggles or free text */
export type SingleFilterKey =
  | 'has_results'
  | 'has_ae_data'
  | 'has_baseline'
  | 'has_outcomes'
  | 'bookmarked'
  | 'search'

export type FilterKey = MultiFilterKey | SingleFilterKey

/** Multi-select keys store string[], single keys store string */
export type Filters = {
  [K in MultiFilterKey]?: string[]
} & {
  [K in SingleFilterKey]?: string
}

const MULTI_KEYS: Set<string> = new Set<string>([
  'status', 'phase', 'study_type', 'therapeutic_area',
  'molecule', 'condition', 'sponsor', 'country',
])

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
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === '') continue
    if (Array.isArray(v) && v.length === 0) continue
    clean[k] = v
  }
  if (Object.keys(clean).length === 0) {
    sessionStorage.removeItem(STORAGE_KEY)
  } else {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  }
}

let listeners: Array<() => void> = []
let snapshot: Filters = load()

function notify() {
  snapshot = { ...snapshot } // new reference for useSyncExternalStore
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

  /** Toggle a value in a multi-select filter, or set a single-value filter */
  toggle(key: FilterKey, value: string): void {
    const next = { ...snapshot }

    if (MULTI_KEYS.has(key)) {
      const mKey = key as MultiFilterKey
      const current = next[mKey] ?? []
      if (current.includes(value)) {
        const updated = current.filter((v) => v !== value)
        if (updated.length === 0) {
          delete next[mKey]
        } else {
          next[mKey] = updated
        }
      } else {
        next[mKey] = [...current, value]
      }
    } else {
      const sKey = key as SingleFilterKey
      // Single-value: toggle on/off
      if (next[sKey] === value) {
        delete next[sKey]
      } else {
        next[sKey] = value
      }
    }

    snapshot = next
    save(snapshot)
    notify()
  },

  /** Set a single-value filter (for search text, etc.) */
  set(key: SingleFilterKey, value: string | null): void {
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

  /** Remove a specific value from a multi-select filter */
  removeValue(key: MultiFilterKey, value: string): void {
    const next = { ...snapshot }
    const current = next[key] ?? []
    const updated = current.filter((v) => v !== value)
    if (updated.length === 0) {
      delete next[key]
    } else {
      next[key] = updated
    }
    snapshot = next
    save(snapshot)
    notify()
  },

  /** Remove an entire filter key */
  removeKey(key: FilterKey): void {
    const next = { ...snapshot }
    delete next[key as MultiFilterKey]
    delete next[key as SingleFilterKey]
    snapshot = next
    save(snapshot)
    notify()
  },

  clearAll(): void {
    snapshot = {}
    save(snapshot)
    notify()
  },

  /** Check if a value is active in a multi-select filter */
  isSelected(key: MultiFilterKey, value: string): boolean {
    return (snapshot[key] ?? []).includes(value)
  },
}

export function useTrialFilters() {
  const filters = useSyncExternalStore(
    trialFilters.subscribe,
    trialFilters.getSnapshot,
  )

  const toggle = useCallback(
    (key: FilterKey, value: string) => trialFilters.toggle(key, value),
    [],
  )

  const set = useCallback(
    (key: SingleFilterKey, value: string | null) => trialFilters.set(key, value),
    [],
  )

  const clearAll = useCallback(() => trialFilters.clearAll(), [])

  // Build flat list of active entries for the filter bar
  const activeEntries: Array<{ key: FilterKey; value: string }> = []
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'search') continue
    if (Array.isArray(v)) {
      for (const val of v) {
        activeEntries.push({ key: k as FilterKey, value: val })
      }
    } else if (v) {
      activeEntries.push({ key: k as FilterKey, value: v })
    }
  }

  return {
    filters,
    toggle,
    set,
    clearAll,
    hasActive: activeEntries.length > 0,
    activeEntries,
  }
}
