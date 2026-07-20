import { useState, useEffect, useMemo } from 'react'
import { X, Trash2, Plus, Network } from 'lucide-react'
import { useWipClient } from '@wip/react'
import { describeWipError } from '@/lib/wip-errors'
import { useQueryClient } from '@tanstack/react-query'
import type { TATerm } from '@/hooks/useTherapeuticAreaTerms'

interface TAManagerProps {
  /** The term being edited. Null means "create new". */
  term: TATerm | null
  /** All TA terms, for the parent-picker dropdown. */
  allTerms: TATerm[]
  terminologyId: string
  onClose: () => void
}

export function TAManager({ term, allTerms, terminologyId, onClose }: TAManagerProps) {
  const client = useWipClient()
  const qc = useQueryClient()

  const isCreateMode = term === null
  const [localTerm, setLocalTerm] = useState<TATerm | null>(term)
  const [newValue, setNewValue] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newAlias, setNewAlias] = useState('')
  const [newParentValue, setNewParentValue] = useState('')
  const [parents, setParents] = useState<Array<{ term_id: string; value: string }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['clintrial', 'ta-terms'] })
    qc.invalidateQueries({ queryKey: ['clintrial', 'ta-tree'] })
  }

  // Load current parents for an existing term
  useEffect(() => {
    if (!localTerm) return
    let cancelled = false
    ;(async () => {
      try {
        const rels = await client.defStore.getParents(localTerm.term_id, 'clintrial')
        if (cancelled) return
        setParents(
          rels
            .filter((r) => r.relation_type === 'is_a')
            .map((r) => ({
              term_id: r.target_term_id,
              value: r.target_term_value || '(unknown)',
            })),
        )
      } catch (e) {
        if (!cancelled) setError(describeWipError(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, localTerm])

  const parentValueSet = useMemo(() => new Set(parents.map((p) => p.value)), [parents])
  const availableParents = useMemo(() => {
    if (!localTerm) return []
    return allTerms
      .filter((t) => t.value !== localTerm.value && !parentValueSet.has(t.value))
      .sort((a, b) => a.value.localeCompare(b.value))
  }, [allTerms, localTerm, parentValueSet])

  const handleClose = () => {
    if (dirty) invalidate()
    onClose()
  }

  // ---- Create new TA ----
  async function handleCreate() {
    const value = newValue.trim().toUpperCase().replace(/\s+/g, '_')
    const label = newLabel.trim() || newValue.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      const created = await client.defStore.createTerms(
        terminologyId,
        [{ value, label }],
        { namespace: 'clintrial' },
      )
      const first = created.results?.[0]
      if (!first || first.status === 'error') {
        throw new Error(first?.error || 'Term creation failed')
      }
      const termId = first.id
      if (!termId) throw new Error('Term created but no term_id returned')
      setLocalTerm({ term_id: termId, value, label, aliases: [] })
      setDirty(true)
    } catch (e) {
      setError(describeWipError(e))
    }
    setBusy(false)
  }

  // ---- Aliases ----
  async function addAlias() {
    if (!localTerm || !newAlias.trim()) return
    setBusy(true)
    setError(null)
    try {
      const updatedAliases = [...localTerm.aliases, newAlias.trim()]
      await client.defStore.updateTerm(localTerm.term_id, { aliases: updatedAliases })
      setLocalTerm({ ...localTerm, aliases: updatedAliases })
      setNewAlias('')
      setDirty(true)
    } catch (e) {
      setError(describeWipError(e))
    }
    setBusy(false)
  }

  async function removeAlias(alias: string) {
    if (!localTerm) return
    setBusy(true)
    setError(null)
    try {
      const updatedAliases = localTerm.aliases.filter((a) => a !== alias)
      await client.defStore.updateTerm(localTerm.term_id, { aliases: updatedAliases })
      setLocalTerm({ ...localTerm, aliases: updatedAliases })
      setDirty(true)
    } catch (e) {
      setError(describeWipError(e))
    }
    setBusy(false)
  }

  // ---- Parents (is_a) ----
  async function addParent() {
    if (!localTerm || !newParentValue) return
    const parentTerm = allTerms.find((t) => t.value === newParentValue)
    if (!parentTerm) return
    setBusy(true)
    setError(null)
    try {
      await client.defStore.createTermRelations(
        [
          {
            source_term_id: localTerm.term_id,
            target_term_id: parentTerm.term_id,
            relation_type: 'is_a',
          },
        ],
        'clintrial',
      )
      setParents([...parents, { term_id: parentTerm.term_id, value: parentTerm.value }])
      setNewParentValue('')
      setDirty(true)
    } catch (e) {
      setError(describeWipError(e))
    }
    setBusy(false)
  }

  async function removeParent(parent: { term_id: string; value: string }) {
    if (!localTerm) return
    setBusy(true)
    setError(null)
    try {
      await client.defStore.deleteTermRelations(
        [
          {
            source_term_id: localTerm.term_id,
            target_term_id: parent.term_id,
            relation_type: 'is_a',
          },
        ],
        'clintrial',
      )
      setParents(parents.filter((p) => p.term_id !== parent.term_id))
      setDirty(true)
    } catch (e) {
      setError(describeWipError(e))
    }
    setBusy(false)
  }

  // ---- Delete term ----
  async function deleteTerm() {
    if (!localTerm) return
    if (
      !confirm(
        `Delete "${localTerm.value}" and all its aliases + parent relationships? This cannot be undone.`,
      )
    )
      return
    setBusy(true)
    setError(null)
    try {
      await client.defStore.deleteTerm(localTerm.term_id)
      invalidate()
      onClose()
    } catch (e) {
      setError(describeWipError(e))
    }
    setBusy(false)
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-primary">
          {isCreateMode && !localTerm
            ? 'New Therapeutic Area'
            : `Manage: ${localTerm?.label ?? localTerm?.value}`}
        </h4>
        <button onClick={handleClose} className="text-text-muted hover:text-text">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Create mode: value + label form */}
      {isCreateMode && !localTerm && (
        <div className="space-y-2">
          <p className="text-xs text-text-muted">
            Value will be uppercased and spaces replaced with underscores (e.g. "Rare Disease" → RARE_DISEASE).
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="Value (e.g. RARE_DISEASE)"
              className="rounded border px-2 py-1 text-xs focus:border-primary focus:outline-none"
              disabled={busy}
            />
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (optional, defaults to value)"
              className="rounded border px-2 py-1 text-xs focus:border-primary focus:outline-none"
              disabled={busy}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={busy || !newValue.trim()}
            className="inline-flex items-center gap-1 rounded border border-primary bg-primary px-3 py-1 text-xs font-medium text-white hover:bg-primary/80 disabled:opacity-40"
          >
            <Plus className="h-3 w-3" />
            Create
          </button>
        </div>
      )}

      {/* Editable sections (shown once the term exists) */}
      {localTerm && (
        <>
          {/* Aliases */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-muted">
              Aliases ({localTerm.aliases.length}) — keywords used to match conditions to this TA
            </p>
            {localTerm.aliases.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {localTerm.aliases.map((alias) => (
                  <span
                    key={alias}
                    className="inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-xs"
                  >
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
            <div className="flex gap-2">
              <input
                type="text"
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAlias()}
                placeholder="New alias / keyword..."
                className="flex-1 rounded border px-2 py-1 text-xs focus:border-primary focus:outline-none"
                disabled={busy}
              />
              <button
                onClick={addAlias}
                disabled={busy || !newAlias.trim()}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            </div>
          </div>

          {/* Parents (is_a) */}
          <div className="space-y-2 border-t border-gray-200 pt-3">
            <p className="flex items-center gap-1 text-xs font-medium text-text-muted">
              <Network className="h-3 w-3" />
              Parent TAs (is_a) — {localTerm.value} inherits from these
            </p>
            {parents.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {parents.map((p) => (
                  <span
                    key={p.term_id}
                    className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-800"
                  >
                    {p.value}
                    <button
                      onClick={() => removeParent(p)}
                      className="text-blue-400 hover:text-danger"
                      disabled={busy}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <select
                value={newParentValue}
                onChange={(e) => setNewParentValue(e.target.value)}
                disabled={busy || availableParents.length === 0}
                className="flex-1 rounded border px-2 py-1 text-xs focus:border-primary focus:outline-none"
              >
                <option value="">
                  {availableParents.length === 0 ? 'No more parents to add' : 'Select a parent TA...'}
                </option>
                {availableParents.map((t) => (
                  <option key={t.term_id} value={t.value}>
                    {t.value}
                  </option>
                ))}
              </select>
              <button
                onClick={addParent}
                disabled={busy || !newParentValue}
                className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            </div>
          </div>

          {/* Delete */}
          <div className="flex items-center gap-2 border-t border-gray-200 pt-3">
            <button
              onClick={deleteTerm}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" />
              Delete TA
            </button>
          </div>
        </>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}
