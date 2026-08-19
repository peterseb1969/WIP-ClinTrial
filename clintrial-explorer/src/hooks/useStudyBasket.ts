import { useSyncExternalStore, useCallback } from 'react'

const STORAGE_KEY = 'clintrial-study-basket'

let snapshot: Set<string> = loadFromStorage()
const listeners = new Set<() => void>()

function loadFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...snapshot]))
  } catch { /* */ }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function getSnapshot() {
  return snapshot
}

export function useStudyBasket() {
  const basket = useSyncExternalStore(subscribe, getSnapshot)

  const add = useCallback((nctId: string) => {
    snapshot = new Set(snapshot)
    snapshot.add(nctId)
    persist()
  }, [])

  const remove = useCallback((nctId: string) => {
    snapshot = new Set(snapshot)
    snapshot.delete(nctId)
    persist()
  }, [])

  const toggle = useCallback((nctId: string) => {
    snapshot = new Set(snapshot)
    if (snapshot.has(nctId)) snapshot.delete(nctId)
    else snapshot.add(nctId)
    persist()
  }, [])

  const addAll = useCallback((nctIds: string[]) => {
    snapshot = new Set(snapshot)
    for (const id of nctIds) snapshot.add(id)
    persist()
  }, [])

  const clear = useCallback(() => {
    snapshot = new Set()
    persist()
  }, [])

  const has = useCallback((nctId: string) => basket.has(nctId), [basket])

  return { basket, count: basket.size, add, addAll, remove, toggle, clear, has }
}
