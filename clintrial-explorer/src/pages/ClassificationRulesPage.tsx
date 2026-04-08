import { useMemo, useState } from 'react'
import { Settings, Plus, Trash2, Search, Lightbulb, Check, X, Play, Loader2, CheckCircle2, AlertCircle, Pin } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { CsvDownloadButton } from '@/components/CsvDownloadButton'
import { PageLoading } from '@/components/LoadingSpinner'
import {
  useClassificationRules,
  useCreateRule,
  useDeleteRule,
  applyRules,
  type ClassificationRule,
} from '@/hooks/useClassificationRules'
import { useAllTrials } from '@/hooks/useAllTrials'
import { useFilteredTrials } from '@/hooks/useFilteredTrials'
import { useTherapeuticAreaTerms } from '@/hooks/useTherapeuticAreaTerms'
import { useRunClassification, type ClassificationResultItem } from '@/hooks/useClassification'
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
  const { trials: filteredTrials } = useFilteredTrials()
  const createRule = useCreateRule()
  const deleteRule = useDeleteRule()
  const classification = useRunClassification()

  const [search, setSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [dryRun, setDryRun] = useState(true)
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
  const [showAllTest, setShowAllTest] = useState(false)
  const [showAllUnclassified, setShowAllUnclassified] = useState(false)

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

  // Get ALL TA values from the terminology (every level of hierarchy)
  const { data: taTerms } = useTherapeuticAreaTerms()
  const taValues = useMemo(() => {
    if (!taTerms || taTerms.length === 0) {
      // Fallback: extract from trial data
      if (!allTrials) return []
      const tas = new Set<string>()
      for (const t of allTrials) {
        for (const ta of t.data.therapeutic_areas || []) tas.add(ta)
      }
      return [...tas].sort()
    }
    return taTerms.map((t) => t.value).sort()
  }, [taTerms, allTrials])

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

  // Compute match counts for each rule
  const ruleMatchCounts = useMemo(() => {
    if (!rules || !conditionStats.length) return new Map<string, number>()
    const counts = new Map<string, number>()
    for (const rule of rules) {
      let matches = 0
      for (const c of conditionStats) {
        const { add, remove } = applyRules([c.name], [rule])
        if (add.size > 0 || remove.size > 0) matches += c.count
      }
      counts.set(rule.document_id, matches)
    }
    return counts
  }, [rules, conditionStats])

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
        <div className="flex items-center gap-3">
          <CsvDownloadButton
            getData={() => ({
              columns: ['Pattern', 'Match Type', 'Action', 'Target TA', 'Priority', 'Notes'],
              rows: (rules || []).map((r) => [
                r.pattern, r.match_type, r.action, r.target_ta,
                String(r.priority ?? ''), r.notes ?? '',
              ]),
            })}
            filenamePrefix="classification-rules"
          />
          <span className="text-sm text-text-muted">
            {rules?.length ?? 0} rules · {formatNumber(unclassified.length)} unclassified · {formatNumber(conditionStats.length)} total conditions
          </span>
        </div>
      </div>

      {/* Run Classification */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>Run Classification</CardTitle>
            <span className="text-xs text-text-muted">
              Scope: {filteredTrials.length} filtered trial{filteredTrials.length !== 1 ? 's' : ''}
            </span>
          </div>
        </CardHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                disabled={classification.isRunning}
                className="accent-primary"
              />
              Dry run (preview only, no changes saved)
            </label>

            {!classification.isRunning ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const trialIds = filteredTrials.map((t) => t.data.nct_id)
                    classification.run({ trialIds, dryRun })
                  }}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  Run Classification
                </button>
              </div>
            ) : (
              <button
                onClick={classification.cancel}
                className="inline-flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Progress */}
          {classification.isRunning && classification.progress && (
            <div className="flex items-center gap-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>{classification.progress.message}</span>
              {classification.progress.total && (
                <span className="text-text-muted">
                  ({classification.progress.processed}/{classification.progress.total})
                </span>
              )}
            </div>
          )}

          {/* Error */}
          {classification.error && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />
              {classification.error}
            </div>
          )}

          {/* Summary */}
          {classification.summary && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              {classification.summary.dryRun ? 'Preview:' : 'Applied:'}{' '}
              {classification.summary.changed} changed, {classification.summary.pinned} pinned (skipped),{' '}
              {classification.summary.unchanged} unchanged out of {classification.summary.total} trials
            </div>
          )}

          {/* Results table */}
          {classification.results.length > 0 && (
            <ClassificationResultsTable results={classification.results} />
          )}
        </div>
      </Card>

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
                  onChange={(e) => {
                    const input = e.target.value
                    // Try to resolve label to value (e.g. "Lung Cancer" → "LUNG_CANCER")
                    const match = taTerms?.find((t) =>
                      t.label.toLowerCase() === input.toLowerCase() ||
                      t.value.toLowerCase() === input.toLowerCase() ||
                      t.value === input
                    )
                    setNewRule((p) => ({ ...p, target_ta: match ? match.value : input }))
                  }}
                  onBlur={() => {
                    // On blur, resolve partial matches
                    const input = newRule.target_ta
                    const match = taTerms?.find((t) =>
                      t.label.toLowerCase() === input.toLowerCase() ||
                      t.value.toLowerCase() === input.toLowerCase() ||
                      t.label.toLowerCase() === input.replace(/_/g, ' ').toLowerCase()
                    )
                    if (match) setNewRule((p) => ({ ...p, target_ta: match.value }))
                  }}
                  placeholder="e.g. Lung Cancer or LUNG_CANCER"
                  list="ta-values"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-surface px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                />
                <datalist id="ta-values">
                  {taValues.map((ta) => {
                    const term = taTerms?.find((t) => t.value === ta)
                    const label = term?.label || ta.replace(/_/g, ' ')
                    return <option key={ta} value={label} />
                  })}
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
                  {(showAllTest ? testResults : testResults.slice(0, 10)).map((c) => (
                    <span key={c.name} className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-800">
                      {c.name} ({c.count})
                    </span>
                  ))}
                  {testResults.length > 10 && (
                    <button
                      onClick={() => setShowAllTest(!showAllTest)}
                      className="text-[10px] font-medium text-blue-600 hover:underline"
                    >
                      {showAllTest ? 'Show less' : `Show all ${testResults.length}`}
                    </button>
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
                  <th className="pb-2 pr-3 text-right">Hits</th>
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
                    <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">
                      {ruleMatchCounts.get(rule.document_id) ?? 0}
                    </td>
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
          {(showAllUnclassified ? unclassified : unclassified.slice(0, 60)).map((c) => (
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
          <button
            onClick={() => setShowAllUnclassified(!showAllUnclassified)}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            {showAllUnclassified ? 'Show less' : `Show all ${unclassified.length} conditions`}
          </button>
        )}
      </Card>
    </div>
  )
}

function ClassificationResultsTable({ results }: { results: ClassificationResultItem[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const displayed = showAll ? results : results.slice(0, 20)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-text-muted">
            <th className="pb-2 pr-3">NCT ID</th>
            <th className="pb-2 pr-3">Status</th>
            <th className="pb-2 pr-3">Old TAs</th>
            <th className="pb-2 pr-3">New TAs</th>
            <th className="pb-2 pr-3">Provenance</th>
          </tr>
        </thead>
        <tbody>
          {displayed.map((r) => (
            <tr key={r.nct_id} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-1.5 pr-3 font-mono text-xs">{r.nct_id}</td>
              <td className="py-1.5 pr-3">
                {r.pinned ? (
                  <Badge variant="muted"><Pin className="inline h-3 w-3 mr-0.5" />Pinned</Badge>
                ) : r.changed ? (
                  <Badge variant="success">Changed</Badge>
                ) : (
                  <Badge variant="muted">Unchanged</Badge>
                )}
              </td>
              <td className="py-1.5 pr-3">
                <div className="flex flex-wrap gap-1">
                  {r.old_tas.map((ta) => (
                    <span key={ta} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">{ta}</span>
                  ))}
                  {r.old_tas.length === 0 && <span className="text-[10px] text-text-muted">none</span>}
                </div>
              </td>
              <td className="py-1.5 pr-3">
                <div className="flex flex-wrap gap-1">
                  {r.new_tas.map((ta) => {
                    const isNew = !r.old_tas.includes(ta)
                    return (
                      <span
                        key={ta}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${isNew ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`}
                      >
                        {ta}
                      </span>
                    )
                  })}
                </div>
              </td>
              <td className="py-1.5 pr-3">
                {r.provenance.length > 0 && (
                  <button
                    onClick={() => setExpanded(expanded === r.nct_id ? null : r.nct_id)}
                    className="text-[10px] text-primary hover:underline"
                  >
                    {r.provenance.length} rule{r.provenance.length !== 1 ? 's' : ''} matched
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Expanded provenance */}
      {expanded && (() => {
        const item = results.find((r) => r.nct_id === expanded)
        if (!item) return null
        return (
          <div className="mt-2 rounded-md bg-blue-50 p-3">
            <p className="text-xs font-medium text-blue-700 mb-2">
              Provenance for {expanded}
            </p>
            <div className="space-y-1">
              {item.provenance.map((p, i) => (
                <div key={i} className="text-[11px] text-blue-800">
                  {p.inherited_from ? (
                    <>
                      <span className="inline-block rounded bg-purple-100 px-1 py-[1px] text-[9px] font-semibold uppercase text-purple-700">
                        ontology
                      </span>
                      {' '}<span className="font-medium">{p.target_ta}</span>
                      {' inherited from '}
                      <span className="font-mono">{p.inherited_from}</span>
                      {' (is_a)'}
                    </>
                  ) : (
                    <>
                      <span className="font-mono">{p.rule_pattern}</span>
                      {' '}<span className="text-blue-600">({p.match_type})</span>
                      {' matched '}<span className="font-medium">"{p.matched_condition}"</span>
                      {' → '}<span className="font-medium">{p.action} {p.target_ta}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {results.length > 20 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-2 text-xs font-medium text-primary hover:underline"
        >
          {showAll ? 'Show less' : `Show all ${results.length} results`}
        </button>
      )}
    </div>
  )
}
