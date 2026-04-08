import { useState, useMemo, useRef, useEffect } from 'react'
import { X, Merge, Trash2, Lightbulb } from 'lucide-react'
import { useWipClient } from '@wip/react'
import { useQueryClient } from '@tanstack/react-query'
import type { ResolvedTerm } from '@/hooks/useAETermResolution'

interface AETermManagerProps {
  term: string
  termId: string | null
  terminologyId: string
  aliases: string[]
  /** All raw AE term strings from the frequency data (for suggestions + typeahead) */
  allRawTerms: string[]
  /** Resolution function to check if a term is already mapped */
  resolve: (raw: string) => ResolvedTerm | null
  onClose: () => void
}

/** Simple similarity score between two strings */
function similarity(a: string, b: string): number {
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  if (al === bl) return 0.95  // Case-only difference
  if (a === b) return 0       // Exact same string, not a suggestion candidate
  // Prefix match
  let prefix = 0
  for (let i = 0; i < Math.min(al.length, bl.length); i++) {
    if (al[i] === bl[i]) prefix++; else break
  }
  const prefixScore = prefix / Math.max(al.length, bl.length)
  // Containment (one contains the other)
  const containsScore = al.includes(bl) || bl.includes(al) ? 0.6 : 0
  // Edit distance ratio for short strings
  let editScore = 0
  if (Math.abs(al.length - bl.length) <= 2 && al.length > 3) {
    let diffs = 0
    const maxLen = Math.max(al.length, bl.length)
    for (let i = 0; i < maxLen; i++) {
      if (al[i] !== bl[i]) diffs++
    }
    if (diffs <= 2) editScore = 1 - (diffs / maxLen)
  }
  return Math.max(prefixScore, containsScore, editScore)
}

export function AETermManager({
  term, termId, terminologyId, aliases, allRawTerms, resolve, onClose,
}: AETermManagerProps) {
  const client = useWipClient()
  const queryClient = useQueryClient()
  const [newAlias, setNewAlias] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showTypeahead, setShowTypeahead] = useState(false)
  const [localAliases, setLocalAliases] = useState<string[]>(aliases)
  const [dirty, setDirty] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['clintrial', 'ae-terms-all'] })
    queryClient.invalidateQueries({ queryKey: ['clintrial', 'ae-frequency'] })
    queryClient.invalidateQueries({ queryKey: ['clintrial', 'ae-severity'] })
  }

  const handleClose = () => {
    if (dirty) invalidate()
    onClose()
  }

  // Suggested merges: raw terms similar to this one that are currently separate entries
  const suggestions = useMemo(() => {
    const currentAliasSet = new Set([term, ...localAliases])
    return allRawTerms
      .filter((raw) => {
        // Skip exact match (same string)
        if (currentAliasSet.has(raw)) return false
        // Must be similar enough
        return similarity(term, raw) >= 0.4
      })
      .map((raw) => ({ raw, score: similarity(term, raw) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
  }, [term, localAliases, allRawTerms])

  // Typeahead: filter raw terms by input text
  const typeaheadResults = useMemo(() => {
    if (!newAlias || newAlias.length < 2) return []
    const q = newAlias.toLowerCase()
    const currentAliasSet = new Set([term.toLowerCase(), ...localAliases.map((a) => a.toLowerCase())])
    return allRawTerms
      .filter((raw) => {
        if (currentAliasSet.has(raw.toLowerCase())) return false
        return raw.toLowerCase().includes(q)
      })
      .sort((a, b) => {
        // Exact prefix first, then by length
        const aPrefix = a.toLowerCase().startsWith(q) ? 0 : 1
        const bPrefix = b.toLowerCase().startsWith(q) ? 0 : 1
        if (aPrefix !== bPrefix) return aPrefix - bPrefix
        return a.length - b.length
      })
      .slice(0, 10)
  }, [newAlias, allRawTerms, term, aliases])

  // Close typeahead on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.parentElement?.contains(e.target as Node)) {
        setShowTypeahead(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Pre-compute a map of raw term → termId for deletion during merge
  // This captures the state BEFORE any merge, so it's not affected by stale resolve()
  const rawTermToId = useMemo(() => {
    const map = new Map<string, string>()
    for (const raw of allRawTerms) {
      const r = resolve(raw)
      if (r) map.set(raw, r.termId)
    }
    return map
  }, [allRawTerms, resolve])

  const addAlias = async (aliasValue?: string) => {
    const value = (aliasValue ?? newAlias).trim()
    if (!termId || !value) return
    setBusy(true)
    setError(null)
    try {
      const updatedAliases = [...localAliases, value]
      await client.defStore.updateTerm(termId, { aliases: updatedAliases })
      // Delete redundant term if it exists
      const otherTermId = rawTermToId.get(value)
      if (otherTermId && otherTermId !== termId) {
        try { await client.defStore.deleteTerm(otherTermId) } catch { /* non-critical */ }
      }
      setLocalAliases(updatedAliases)
      setNewAlias('')
      setShowTypeahead(false)
      setDirty(true)
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }

  const removeAlias = async (alias: string) => {
    if (!termId) return
    setBusy(true)
    setError(null)
    try {
      const updatedAliases = localAliases.filter((a) => a !== alias)
      await client.defStore.updateTerm(termId, { aliases: updatedAliases })
      setLocalAliases(updatedAliases)
      setDirty(true)
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }

  const deleteTerm = async () => {
    if (!termId) return
    if (!confirm(`Delete "${term}" and all its aliases? This cannot be undone.`)) return
    setBusy(true)
    setError(null)
    try {
      await client.defStore.deleteTerm(termId)
      invalidate()
      onClose()
    } catch (e) {
      setError(String(e))
    }
    setBusy(false)
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-primary">Manage: {term}</h4>
        <button onClick={handleClose} className="text-text-muted hover:text-text">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Not in terminology */}
      {!termId && (
        <p className="text-xs text-amber-600">
          Not in terminology (appears only in raw AE data).
          <button
            onClick={async () => {
              setBusy(true)
              try {
                await client.defStore.createTerms(terminologyId, [{ value: term, label: term }], { namespace: 'clintrial' })
                invalidate()
              } catch (e) {
                setError(String(e))
              }
              setBusy(false)
            }}
            className="ml-2 text-primary underline"
            disabled={busy}
          >
            Add to terminology
          </button>
        </p>
      )}

      {/* Suggested merges */}
      {termId && suggestions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-text-muted flex items-center gap-1">
            <Lightbulb className="h-3 w-3 text-amber-500" />
            Similar terms (click to merge)
          </p>
          <div className="flex flex-wrap gap-1">
            {suggestions.map(({ raw, score }, i) => (
              <button
                key={`${i}-${raw}`}
                onClick={() => addAlias(raw)}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                title={`Similarity: ${(score * 100).toFixed(0)}% — click to merge "${raw}" into "${term}"`}
              >
                <Merge className="h-2.5 w-2.5" />
                {raw}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Existing aliases */}
      {termId && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-muted">
            Aliases ({localAliases.length})
            {localAliases.length > 0 && ' — these raw strings resolve to this term'}
          </p>
          {localAliases.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {localAliases.map((alias) => (
                <span key={alias} className="inline-flex items-center gap-1 rounded-full bg-white border px-2 py-0.5 text-xs">
                  {alias}
                  <button
                    onClick={() => removeAlias(alias)}
                    className="text-text-muted hover:text-danger"
                    disabled={busy}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Typeahead search input */}
          <div className="relative" ref={inputRef}>
            <div className="flex gap-2">
              <input
                type="text"
                value={newAlias}
                onChange={(e) => { setNewAlias(e.target.value); setShowTypeahead(true) }}
                onFocus={() => setShowTypeahead(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addAlias()
                  if (e.key === 'Escape') setShowTypeahead(false)
                }}
                placeholder="Search AE terms to merge..."
                className="flex-1 rounded border px-2 py-1 text-xs focus:border-primary focus:outline-none"
                disabled={busy}
              />
              <button
                onClick={() => addAlias()}
                disabled={busy || !newAlias.trim()}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                <Merge className="h-3 w-3" />
                Merge
              </button>
            </div>

            {/* Typeahead dropdown */}
            {showTypeahead && typeaheadResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg max-h-48 overflow-y-auto">
                {typeaheadResults.map((raw, i) => {
                  const resolved = resolve(raw)
                  return (
                    <button
                      key={`${i}-${raw}`}
                      onClick={() => addAlias(raw)}
                      disabled={busy}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-50 text-left disabled:opacity-40"
                    >
                      <span>{raw}</span>
                      {resolved && (
                        <span className="text-[10px] text-text-muted ml-2">
                          → {resolved.canonical}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {termId && (
        <div className="flex items-center gap-2 pt-1 border-t">
          <button
            onClick={deleteTerm}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
            Delete term
          </button>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
