const STORAGE_KEY = 'clintrial-bookmarks'

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function save(bookmarks: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...bookmarks]))
}

let listeners: Array<() => void> = []
let snapshot = load()

export const bookmarks = {
  getSnapshot(): Set<string> {
    return snapshot
  },

  subscribe(listener: () => void): () => void {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((l) => l !== listener)
    }
  },

  toggle(nctId: string): void {
    const next = new Set(snapshot)
    if (next.has(nctId)) {
      next.delete(nctId)
    } else {
      next.add(nctId)
    }
    snapshot = next
    save(snapshot)
    listeners.forEach((l) => l())
  },

  has(nctId: string): boolean {
    return snapshot.has(nctId)
  },

  count(): number {
    return snapshot.size
  },

  exportJson(): string {
    return JSON.stringify(
      { bookmarks: [...snapshot], exported_at: new Date().toISOString() },
      null,
      2,
    )
  },

  importJson(json: string): { added: number; total: number } {
    const parsed = JSON.parse(json) as { bookmarks: string[] }
    const next = new Set(snapshot)
    let added = 0
    for (const id of parsed.bookmarks) {
      if (!next.has(id)) {
        next.add(id)
        added++
      }
    }
    snapshot = next
    save(snapshot)
    listeners.forEach((l) => l())
    return { added, total: snapshot.size }
  },
}
