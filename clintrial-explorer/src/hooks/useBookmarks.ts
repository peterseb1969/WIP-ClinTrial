import { useSyncExternalStore, useCallback } from 'react'
import { bookmarks } from '@/lib/bookmarks'

/** Manage bookmarked trial NCT IDs backed by localStorage */
export function useBookmarks() {
  const snap = useSyncExternalStore(
    bookmarks.subscribe,
    bookmarks.getSnapshot,
  )

  const toggle = useCallback((nctId: string) => bookmarks.toggle(nctId), [])
  const has = useCallback((nctId: string) => snap.has(nctId), [snap])

  return {
    bookmarkedIds: snap,
    count: snap.size,
    toggle,
    has,
    exportJson: bookmarks.exportJson,
    importJson: bookmarks.importJson,
  }
}
