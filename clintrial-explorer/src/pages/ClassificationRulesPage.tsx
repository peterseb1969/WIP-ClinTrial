import { useMemo, useState } from 'react'
import { Settings, Plus, Trash2, Search, Lightbulb, Check, X } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { PageLoading } from '@/components/LoadingSpinner'
import {
  useClassificationRules,
  useCreateRule,
  useDeleteRule,
  applyRules,
  type ClassificationRule,
} from '@/hooks/useClassificationRules'
import { useAllTrials } from '@/hooks/useAllTrials'
import { formatNumber } from '@/lib/utils'

const MATCH_TYPES = [
  { value: 'CONTAINS', label: 'Contains' },
  { value: 'EXACT', label: 'Exact' },
  { value: 'WORD_BOUNDARY', label: 'Word Boundary' },
]

const ACTIONS = [
  { value: 'ADD', label: 'Add' },
  { value: 'REMOVE', label: 'Remove' },
]

export function ClassificationRulesPage() {
  const { data: rules, isLoading: loadingRules } = useClassificationRules()
  const { data: allTrials, isLoading: loadingTrials } = useAllTrials()
  const createRule = useCreateRule()
  const deleteRule = useDeleteRule()

  const [search, setSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newRule, setNewRule] = useState({
    pattern: '',
    match_type: 'CONTAINS',
    action: 'ADD',
    target_ta: '',
    priority: 0,
    notes: '',
    trial_nct_id: '',
  })
  const [testPattern, setTestPattern] = useState('')

  // Get all unique conditions with frequency
  const conditionStats = useMemo(() => {
    if (!allTrials) return []
    const counts = new Map<string, number>()
    for (const t of allTrials) {
      for (const c of t.data.conditions || []) {
        counts.set(c, (counts.get(c) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [allTrials])

  // Find unclassified conditions (no TA from stored data AND no rule matches)
  const unclassified = useMemo(() => {
    if (!allTrials || !rules) return []
    const unmatched = new Map<string, number>()

    for (const t of allTrials) {
      const storedTAs = t.data.therapeutic_areas || []
      const conditions = t.data.conditions || []
      if (storedTAs.length > 0) continue // already classified by import

      // Check if any rule matches
      const { add } = applyRules(conditions, rules)
      if (add.size > 0) continue

      for (const c of conditions) {
        unmatched.set(c, (unmatched.get(c) || 0) + 1)
      }
    }

    return [...unmatched.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [allTrials, rules])

  // Test pattern preview
  const testResults = useMemo(() => {
    if (!testPattern || !conditionStats.length) return null
    const mockRule: ClassificationRule = {
      document_id: '',
      rule_type: 'CONDITION_TO_TA',
      pattern: testPattern,
      match_type: newRule.match_type,
      action: newRule.action,
      target_ta: newRule.target_ta || '(target)',
      priority: 0,
      enabled: true,
      notes: null,
      trial_nct_id: null,
    }
    const matching = conditionStats.filter((c) => {
      const { add, remove } = applyRules([c.name], [mockRule])
      return add.size > 0 || remove.size > 0
    })
    return matching
  }, [testPattern, newRule.match_type, newRule.action, newRule.target_ta, conditionStats])

  // Get unique TA values for dropdown
  const taValues = useMemo(() => {
    if (!allTrials) return []
    const tas = new Set<string>()
    for (const t of allTrials) {
      for (const ta of t.data.therapeutic_areas || []) {
        tas.add(ta)
      }
    }
    // Also add common ones that might not be in data yet
    return [...tas].sort()
  }, [allTrials])

  async function handleCreateRule() {
    if (!newRule.pattern || !newRule.target_ta) return
    await createRule.mutateAsync({
      rule_type: 'CONDITION_TO_TA',
      pattern: newRule.pattern,
      match_type: newRule.match_type,
      action: newRule.action as string,
      target_ta: newRule.target_ta,
      priority: newRule.priority,
      enabled: true,
      notes: newRule.notes || null,
      trial_nct_id: newRule.trial_nct_id || null,
    })
    setNewRule({ pattern: '', match_type: 'CONTAINS', action: 'ADD', target_ta: '', priority: 0, notes: '', trial_nct_id: '' })
    setShowAddForm(false)
    setTestPattern('')
  }

  function prefillFromCondition(condition: string) {
    setNewRule((prev) => ({ ...prev, pattern: condition.toLowerCase(), match_type: 'CONTAINS' }))
    setTestPattern(condition.toLowerCase())
    setShowAddForm(true)
  }

  if (loadingRules || loadingTrials) return <PageLoading message="Loading rules..." />

  const filteredRules = rules?.filter((r) =>
    !search || r.pattern.toLowerCase().includes(search.toLowerCase()) ||
    r.target_ta.toLowerCase().includes(search.toLowerCase()),
  ) ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Classification Rules</h1>
        </div>
        <span className="text-sm text-text-muted">
          {rules?.length ?? 0} rules · {formatNumber(unclassified.length)} unclassified conditions
        </span>
      </div>

      {/* Add Rule Form */}
      {showAddForm ? (
        <Card>
          <CardHeader><CardTitle>New Rule</CardTitle></CardHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-xs font-medium text-text-muted">Pattern</label>
                <input
                  type="text"
                  value={newRule.pattern}
                  onChange={(e) => { setNewRule((p) => ({ ...p, pattern: e.target.value })); setTestPattern(e.target.value) }}
                  placeholder="e.g. frontotemporal"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted">Match Type</label>
                <select
                  value={newRule.match_type}
                  onChange={(e) => setNewRule((p) => ({ ...p, match_type: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                >
                  {MATCH_TYPES.map((mt) => <option key={mt.value} value={mt.value}>{mt.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted">Action</label>
                <select
                  value={newRule.action}
                  onChange={(e) => setNewRule((p) => ({ ...p, action: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                >
                  {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted">Target TA</label>
                <input
                  type="text"
                  value={newRule.target_ta}
                  onChange={(e) => setNewRule((p) => ({ ...p, target_ta: e.target.value.toUpperCase() }))}
                  placeholder="e.g. NEUROSCIENCE"
                  list="ta-values"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
                <datalist id="ta-values">
                  {taValues.map((ta) => <option key={ta} value={ta} />)}
                </datalist>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="text-xs font-medium text-text-muted">Priority</label>
                <input
                  type="number"
                  value={newRule.priority}
                  onChange={(e) => setNewRule((p) => ({ ...p, priority: parseInt(e.target.value) || 0 }))}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted">Trial NCT ID (optional, for trial-specific rules)</label>
                <input
                  type="text"
                  value={newRule.trial_nct_id}
                  onChange={(e) => setNewRule((p) => ({ ...p, trial_nct_id: e.target.value }))}
                  placeholder="Leave empty for global"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text-muted">Notes</label>
                <input
                  type="text"
                  value={newRule.notes}
                  onChange={(e) => setNewRule((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Why this rule?"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
            </div>

            {/* Test preview */}
            {testResults && testResults.length > 0 && (
              <div className="rounded-md bg-blue-50 p-3">
                <p className="text-xs font-medium text-blue-700 mb-1">
                  Preview: {testResults.length} condition(s) would match
                </p>
                <div className="flex flex-wrap gap-1">
                  {testResults.slice(0, 10).map((c) => (
                    <span key={c.name} className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-800">
                      {c.name} ({c.count})
                    </span>
                  ))}
                  {testResults.length > 10 && (
                    <span className="text-[10px] text-blue-600">+{testResults.length - 10} more</span>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleCreateRule}
                disabled={!newRule.pattern || !newRule.target_ta || createRule.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                {createRule.isPending ? 'Creating...' : 'Create Rule'}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setTestPattern('') }}
                className="inline-flex items-center gap-1.5 rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-text-muted hover:bg-gray-200"
              >
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
          </div>
        </Card>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add Rule
        </button>
      )}

      {/* Active Rules */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>Active Rules ({filteredRules.length})</CardTitle>
            <div className="relative w-48">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search rules..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-surface py-1 pl-8 pr-3 text-xs focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        </CardHeader>
        {filteredRules.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-text-muted">
                  <th className="pb-2 pr-3">Pattern</th>
                  <th className="pb-2 pr-3">Match</th>
                  <th className="pb-2 pr-3">Action</th>
                  <th className="pb-2 pr-3">Target TA</th>
                  <th className="pb-2 pr-3 text-right">Priority</th>
                  <th className="pb-2 pr-3">Scope</th>
                  <th className="pb-2 pr-3">Notes</th>
                  <th className="pb-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {filteredRules.map((rule) => (
                  <tr key={rule.document_id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-3 font-mono text-xs">{rule.pattern}</td>
                    <td className="py-1.5 pr-3">
                      <Badge variant="muted">{rule.match_type}</Badge>
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge variant={rule.action === 'REMOVE' ? 'danger' : 'success'}>
                        {rule.action}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-medium">{rule.target_ta.replace(/_/g, ' ')}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{rule.priority}</td>
                    <td className="py-1.5 pr-3 text-xs text-text-muted">
                      {rule.trial_nct_id || 'Global'}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-text-muted truncate max-w-[150px]">
                      {rule.notes}
                    </td>
                    <td className="py-1.5">
                      <button
                        onClick={() => deleteRule.mutate(rule.document_id)}
                        className="text-text-muted hover:text-danger"
                        title="Delete rule"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-text-muted">
            No rules yet. Add one above, or click a suggestion below.
          </p>
        )}
      </Card>

      {/* Unclassified Conditions */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Lightbulb className="mr-2 inline h-4 w-4" />
            Unclassified Conditions ({formatNumber(unclassified.length)})
          </CardTitle>
        </CardHeader>
        <p className="mb-3 text-xs text-text-muted">
          Conditions from trials that have no therapeutic area — neither from import nor from rules.
          Click to pre-fill a new rule.
        </p>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {unclassified.slice(0, 60).map((c) => (
            <button
              key={c.name}
              onClick={() => prefillFromCondition(c.name)}
              className="flex items-center justify-between rounded-md px-2 py-1 text-xs text-left hover:bg-blue-50 transition-colors"
            >
              <span className="truncate pr-2">{c.name}</span>
              <span className="flex-shrink-0 tabular-nums text-[10px] text-text-muted">{c.count}</span>
            </button>
          ))}
        </div>
        {unclassified.length > 60 && (
          <p className="mt-2 text-xs text-text-muted">+{unclassified.length - 60} more</p>
        )}
      </Card>
    </div>
  )
}
