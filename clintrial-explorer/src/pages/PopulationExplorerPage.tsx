import React, { useState, useMemo, useCallback, Fragment } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Users, Search, RotateCcw, X, GitCompare, Check, HelpCircle, ChevronRight, ChevronDown, Filter, ListPlus, ListChecks, TestTubes, FileText, Trash2, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  usePopulationSearch,
  useEligibilityOntology,
  setOntologyLabels,
  getGroupLabel,
  parseArray,
  useCriteriaGroupSummary,
  useCriteriaGroupDetail,
  useCriteriaSearch,
  type PopulationProfile,
  type ScoredTrial,
  type MatchStatus,
  type Criterion,
  type CriteriaTextEntry,
} from '@/hooks/usePopulationExplorer'
import { useTrialFilters } from '@/hooks/useTrialFilters'
import { useStudyBasket } from '@/hooks/useStudyBasket'
import { PageLoading } from '@/components/LoadingSpinner'
import { Card } from '@/components/Card'
import { formatNumber } from '@/lib/utils'

const PAGE_SIZE = 25
const DEFAULT_PROFILE: PopulationProfile = { samplesOnly: true }

interface FacetFilter {
  groups: Set<string>
  categories: Set<string>
}
const EMPTY_FACET_FILTER: FacetFilter = { groups: new Set(), categories: new Set() }

// ─── Small reusable components ───

function MatchIcon({ status }: { status: MatchStatus }) {
  if (status === 'confirmed') return <Check className="h-4 w-4 text-success" />
  if (status === 'contradicted') return <X className="h-4 w-4 text-danger" />
  return <HelpCircle className="h-4 w-4 text-text-muted/40" />
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  if (max === 0) return <span className="text-xs text-text-muted">—</span>
  const pct = Math.max(0, (score / max) * 100)
  const color = score === max ? 'bg-success' : score > 0 ? 'bg-accent' : score < 0 ? 'bg-danger' : 'bg-text-muted/30'
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-2 w-16 rounded-full bg-surface-alt overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium text-text-secondary">{score}/{max}</span>
    </div>
  )
}

function boolDisplay(val: boolean | null | undefined): string {
  if (val === true) return 'Yes'
  if (val === false) return 'No'
  return '—'
}

function ToggleRow({ label, checked, onChange, bold }: {
  label: string; checked?: boolean; onChange: (v: boolean | undefined) => void; bold?: boolean
}) {
  const isActive = checked === true
  return (
    <button
      onClick={() => onChange(isActive ? undefined : true)}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors',
        isActive ? 'bg-primary/10 text-primary' : 'text-text-secondary hover:bg-surface-alt',
      )}
    >
      <div className={cn(
        'h-4 w-4 rounded border flex items-center justify-center transition-colors',
        isActive ? 'bg-primary border-primary' : 'border-border',
      )}>
        {isActive && <Check className="h-3 w-3 text-white" />}
      </div>
      <span className={bold ? 'font-medium' : ''}>{label}</span>
    </button>
  )
}

// ─── ProfileSidebar (slim — only profile controls) ───

function ProfileSidebar({
  profile, onChange, matchCount, totalCount,
}: {
  profile: PopulationProfile; onChange: (p: PopulationProfile) => void
  matchCount: number; totalCount: number
}) {
  const { filters, hasActive } = useTrialFilters()
  const basket = useStudyBasket()
  const update = useCallback(
    (patch: Partial<PopulationProfile>) => onChange({ ...profile, ...patch }),
    [profile, onChange],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-primary">Profile</h3>
        <button onClick={() => onChange(DEFAULT_PROFILE)} className="text-xs text-text-muted hover:text-primary flex items-center gap-1">
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>

      <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2 text-center">
        <span className="text-lg font-bold text-primary">{formatNumber(matchCount)}</span>
        <span className="text-xs text-text-muted ml-1">of {formatNumber(totalCount)} trials</span>
        {basket.count > 0 && <div className="text-[10px] text-accent mt-0.5">{basket.count} in study list</div>}
      </div>

      {hasActive && (
        <div className="rounded border border-accent/30 bg-accent/5 px-2 py-1.5">
          <div className="flex items-center gap-1 text-xs text-accent font-medium mb-1">
            <Filter className="h-3 w-3" /> Global filters
          </div>
          <div className="flex flex-wrap gap-1">
            {filters.molecule?.map((m) => <span key={m} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{m}</span>)}
            {filters.condition?.map((c) => <span key={c} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{c}</span>)}
            {filters.therapeutic_area?.map((ta) => <span key={ta} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{ta}</span>)}
            {filters.phase?.map((p) => <span key={p} className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">Phase {p}</span>)}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-text-secondary mb-1 block">Search eligibility text</label>
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-text-muted" />
          <input type="text" placeholder="e.g. platinum, RECIST"
            value={profile.eligSearch ?? ''}
            onChange={(e) => update({ eligSearch: e.target.value || undefined })}
            className="w-full rounded border border-border bg-surface pl-7 pr-2 py-1.5 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-text-secondary mb-1 block">Min Age</label>
          <input type="number" placeholder="18"
            value={profile.ageMin ?? ''}
            onChange={(e) => update({ ageMin: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary mb-1 block">Max Age</label>
          <input type="number" placeholder="75"
            value={profile.ageMax ?? ''}
            onChange={(e) => update({ ageMax: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm" />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-text-secondary mb-1 block">ECOG</label>
        <select
          value={profile.ecogMax === undefined || profile.ecogMax === null ? '' : profile.ecogMax}
          onChange={(e) => update({ ecogMax: e.target.value ? Number(e.target.value) : null })}
          className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Any</option>
          <option value={1}>0-1</option>
          <option value={2}>0-2</option>
          <option value={3}>0-3</option>
        </select>
      </div>

      <div>
        <label className="text-xs font-medium text-text-secondary mb-1 block">Population</label>
        <div className="space-y-0.5">
          <ToggleRow label="HIV+ allowed" checked={profile.hivAllowed} onChange={(v) => update({ hivAllowed: v })} />
          <ToggleRow label="Autoimmune allowed" checked={profile.autoImmuneAllowed} onChange={(v) => update({ autoImmuneAllowed: v })} />
          <ToggleRow label="CNS mets allowed" checked={profile.cnsAllowed} onChange={(v) => update({ cnsAllowed: v })} />
          <ToggleRow label="Healthy volunteers" checked={profile.healthyVolunteers} onChange={(v) => update({ healthyVolunteers: v })} />
          <ToggleRow label="Measurable disease" checked={profile.measurableRequired} onChange={(v) => update({ measurableRequired: v })} />
        </div>
      </div>

      <div className="border-t border-border pt-2">
        <ToggleRow label="Samples only" checked={profile.samplesOnly} onChange={(v) => update({ samplesOnly: v === true ? true : false })} bold />
      </div>
    </div>
  )
}

// ─── CriteriaBrowser (full-width, in center area) ───

type TypeFilter = 'all' | 'inclusion' | 'exclusion'


function CriteriaBrowser({
  facetFilter, onFacetChange,
}: {
  facetFilter: FacetFilter; onFacetChange: (f: FacetFilter) => void
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [criteriaSearch, setCriteriaSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  // Debounce search for server queries
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>()
  const handleSearchChange = useCallback((value: string) => {
    setCriteriaSearch(value)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300)
  }, [])

  // Server-side data
  const { data: groupSummary } = useCriteriaGroupSummary()
  const { data: searchResults } = useCriteriaSearch(debouncedSearch || undefined, typeFilter)

  const hasFacetFilters = facetFilter.groups.size > 0 || facetFilter.categories.size > 0

  // Build group list from summary
  const groups = useMemo(() => {
    if (!groupSummary) return []
    const list: { group: string; label: string; trialCount: number; count: number }[] = []
    for (const [group, info] of groupSummary) {
      // Apply type filter to visibility
      if (typeFilter === 'inclusion' && info.inclusionCount === 0) continue
      if (typeFilter === 'exclusion' && info.exclusionCount === 0) continue
      list.push({ group, label: getGroupLabel(group), trialCount: info.trialCount, count: info.count })
    }
    list.sort((a, b) => b.count - a.count)

    // If searching, filter to groups that have results
    if (debouncedSearch && searchResults) {
      return list.filter((g) => searchResults.has(g.group))
    }
    return list
  }, [groupSummary, typeFilter, debouncedSearch, searchResults])

  const toggleExpand = useCallback((group: string) => {
    setExpandedGroups((prev) => { const n = new Set(prev); n.has(group) ? n.delete(group) : n.add(group); return n })
  }, [])

  const toggleFilterGroup = useCallback((group: string) => {
    const next = { groups: new Set(facetFilter.groups), categories: new Set(facetFilter.categories) }
    if (next.groups.has(group)) {
      next.groups.delete(group)
      for (const key of next.categories) { if (key.startsWith(group + '::')) next.categories.delete(key) }
    } else { next.groups.add(group) }
    onFacetChange(next)
  }, [facetFilter, onFacetChange])

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <button onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Layers className="h-4 w-4 text-primary" />
          Criteria Groups ({groups.length})
          {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-text-muted" />}
        </button>
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-border overflow-hidden">
            {(['all', 'inclusion', 'exclusion'] as TypeFilter[]).map((t) => (
              <button key={t} onClick={() => setTypeFilter(t)}
                className={cn('px-2 py-0.5 text-[10px] font-medium transition-colors',
                  typeFilter === t ? 'bg-primary text-white' : 'text-text-muted hover:bg-surface-alt',
                )}>
                {t === 'all' ? 'All' : t === 'inclusion' ? 'Inclusion' : 'Exclusion'}
              </button>
            ))}
          </div>
          {hasFacetFilters && (
            <button onClick={() => onFacetChange(EMPTY_FACET_FILTER)} className="text-[10px] text-danger hover:underline">Clear filters</button>
          )}
        </div>
      </div>
      {!collapsed && (
        <div className="px-4 py-3">
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-text-muted" />
              <input type="text" placeholder="Search criteria across all groups (server-side, no limits)..."
                value={criteriaSearch} onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full rounded border border-border bg-surface pl-8 pr-8 py-1.5 text-sm" />
              {criteriaSearch && (
                <button onClick={() => { handleSearchChange(''); setDebouncedSearch(''); setExpandedGroups(new Set()) }} className="absolute right-2 top-2 text-text-muted hover:text-text-primary"><X className="h-3.5 w-3.5" /></button>
              )}
            </div>
            {debouncedSearch && searchResults && (
              <button
                onClick={() => setExpandedGroups(new Set(searchResults.keys()))}
                className="rounded border border-primary/30 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/5 whitespace-nowrap"
              >
                Expand all matches
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 max-h-[50vh] overflow-y-auto">
            {groups.map((g) => {
              const isGroupFiltered = facetFilter.groups.has(g.group)
              const isExpanded = expandedGroups.has(g.group)

              return (
                <div key={g.group} className={cn('rounded', isExpanded && 'col-span-2 bg-surface-alt/30 p-2 mb-1')}>
                  <div className="flex items-center">
                    <button onClick={() => toggleExpand(g.group)} className="p-0.5 text-text-muted hover:text-text-primary">
                      {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => toggleFilterGroup(g.group)}
                      className={cn(
                        'flex-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs transition-colors',
                        isGroupFiltered ? 'bg-primary/10 text-primary font-semibold' : 'text-text-primary hover:bg-surface-alt',
                      )}
                    >
                      <span className="flex-1 truncate">{g.label}</span>
                      <span className={cn('text-[10px] flex-shrink-0', isGroupFiltered ? 'text-primary' : 'text-text-muted')}>{g.trialCount}t</span>
                    </button>
                  </div>

                  {isExpanded && (
                    <GroupDetail
                      group={g.group}
                      typeFilter={typeFilter}
                      searchResults={debouncedSearch && searchResults ? searchResults.get(g.group) : undefined}
                      onCriteriaClick={(text) => handleSearchChange(text.slice(0, 60))}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

function GroupDetail({ group, typeFilter, searchResults, onCriteriaClick }: {
  group: string; typeFilter: TypeFilter; searchResults?: CriteriaTextEntry[]; onCriteriaClick: (text: string) => void
}) {
  const { data: criteria, isLoading } = useCriteriaGroupDetail(group, typeFilter)
  const [showAll, setShowAll] = useState(false)

  // Use search results if available, otherwise use the full group detail query
  const displayCriteria = searchResults ?? criteria ?? []
  const visible = showAll ? displayCriteria : displayCriteria.slice(0, 15)

  if (isLoading && !searchResults) return <div className="ml-5 text-[10px] text-text-muted py-1">Loading...</div>
  if (displayCriteria.length === 0) return <div className="ml-5 text-[10px] text-text-muted py-1 italic">No criteria</div>

  return (
    <div className="mt-1 ml-2">
      <div className="text-[10px] text-text-muted font-medium mb-1">
        {searchResults ? `${displayCriteria.length} matching criteria` : `${displayCriteria.length} criteria (all, no limit)`}
      </div>
      <div className="space-y-0.5 max-h-64 overflow-y-auto">
        {visible.map((c, i) => (
          <button key={i} onClick={() => onCriteriaClick(c.text)}
            className="flex w-full items-start gap-1 px-1 py-0.5 text-[10px] leading-tight text-left rounded hover:bg-primary/5 transition-colors"
            title="Click to search for this criterion">
            <span className={cn('flex-shrink-0 font-medium uppercase', c.type === 'inclusion' ? 'text-success' : 'text-danger')}>
              {c.type === 'inclusion' ? 'IN' : 'EX'}
            </span>
            <span className="text-text-secondary flex-1">{c.text}</span>
            <span className="text-text-muted flex-shrink-0 ml-1">{c.trialCount}t</span>
          </button>
        ))}
      </div>
      {displayCriteria.length > 15 && (
        <button onClick={() => setShowAll(!showAll)} className="text-[10px] text-primary hover:underline mt-0.5 px-1">
          {showAll ? 'Show less' : `Show all ${displayCriteria.length}`}
        </button>
      )}
    </div>
  )
}


// ─── ComparisonMatrix ───

function ComparisonMatrix({ trials, onClose }: { trials: ScoredTrial[]; onClose: () => void }) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['structured']))
  const toggleGroup = useCallback((g: string) => {
    setExpandedGroups((p) => { const n = new Set(p); n.has(g) ? n.delete(g) : n.add(g); return n })
  }, [])

  const structuredRows = [
    { key: 'age', label: 'Age Range', getValue: (t: ScoredTrial) => { const p = t.profile; return p.min_age && p.max_age ? `${p.min_age}–${p.max_age}` : p.min_age ? `≥${p.min_age}` : p.max_age ? `≤${p.max_age}` : '—' }},
    { key: 'ecog', label: 'ECOG', getValue: (t: ScoredTrial) => { const p = t.profile; return p.ecog_min !== null && p.ecog_max !== null ? `${p.ecog_min}–${p.ecog_max}` : p.ecog_max !== null ? `≤${p.ecog_max}` : '—' }},
    { key: 'life_exp', label: 'Life Expectancy', getValue: (t: ScoredTrial) => t.profile.life_expectancy_weeks ? `≥${t.profile.life_expectancy_weeks} wks` : '—' },
    { key: 'pregnancy', label: 'Pregnancy Excl.', getValue: (t: ScoredTrial) => boolDisplay(t.profile.pregnancy_excluded) },
    { key: 'hiv', label: 'HIV Excluded', getValue: (t: ScoredTrial) => boolDisplay(t.profile.hiv_excluded) },
    { key: 'hbv', label: 'HBV Excluded', getValue: (t: ScoredTrial) => boolDisplay(t.profile.hbv_excluded) },
    { key: 'hcv', label: 'HCV Excluded', getValue: (t: ScoredTrial) => boolDisplay(t.profile.hcv_excluded) },
    { key: 'cns', label: 'CNS Excluded', getValue: (t: ScoredTrial) => boolDisplay(t.profile.cns_excluded) },
    { key: 'autoimmune', label: 'Autoimmune Excl.', getValue: (t: ScoredTrial) => boolDisplay(t.profile.autoimmune_excluded) },
    { key: 'measurable', label: 'Measurable Req.', getValue: (t: ScoredTrial) => boolDisplay(t.profile.requires_measurable_disease) },
    { key: 'samples', label: 'Samples', getValue: (t: ScoredTrial) => t.sampleCount > 0 ? formatNumber(t.sampleCount) : '—' },
  ]

  const allGroups = useMemo(() => {
    const gs = new Set<string>()
    for (const t of trials) for (const c of t.criteria) if (c.semantic_group && c.semantic_group !== 'UNCLASSIFIED') gs.add(c.semantic_group)
    return [...gs].sort()
  }, [trials])

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2"><GitCompare className="h-4 w-4" /> Compare {trials.length} Trials</h3>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="h-4 w-4" /></button>
      </div>
      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface-alt">
              <th className="px-3 py-2 text-left text-xs font-medium text-text-muted w-40">Dimension</th>
              {trials.map((t) => (
                <th key={t.profile.nct_id} className="px-3 py-2 text-left text-xs font-medium text-text-muted min-w-[160px]">
                  <Link to={`/trials/${t.profile.nct_id}`} className="text-primary hover:underline">{t.profile.org_study_id || t.profile.nct_id}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={trials.length + 1} className="bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary cursor-pointer" onClick={() => toggleGroup('structured')}>
              <span className="inline-flex items-center gap-1">{expandedGroups.has('structured') ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Structured Fields</span>
            </td></tr>
            {expandedGroups.has('structured') && structuredRows.map((dim) => (
              <tr key={dim.key} className="border-t border-border">
                <td className="px-3 py-1.5 text-xs font-medium text-text-secondary">{dim.label}</td>
                {trials.map((t) => { const val = dim.getValue(t); return <td key={t.profile.nct_id} className={cn('px-3 py-1.5 text-xs', val === '—' ? 'text-text-muted' : 'text-text-primary')}>{val}</td> })}
              </tr>
            ))}
            {allGroups.map((group) => (
              <Fragment key={group}>
                <tr><td colSpan={trials.length + 1} className="bg-surface-alt px-3 py-1.5 text-xs font-semibold text-text-secondary cursor-pointer border-t border-border" onClick={() => toggleGroup(group)}>
                  <span className="inline-flex items-center gap-1">{expandedGroups.has(group) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} {getGroupLabel(group)}</span>
                </td></tr>
                {expandedGroups.has(group) && (
                  <tr className="border-t border-border">
                    <td className="px-3 py-1.5 text-xs text-text-muted align-top">Criteria</td>
                    {trials.map((t) => {
                      const gc = t.criteria.filter((c) => c.semantic_group === group)
                      return (
                        <td key={t.profile.nct_id} className="px-3 py-1.5 text-xs align-top">
                          {gc.length === 0 ? <span className="text-text-muted italic">None</span> : (
                            <ul className="space-y-1">
                              {gc.slice(0, 8).map((c, i) => (
                                <li key={i} className="flex gap-1">
                                  <span className={cn('flex-shrink-0 text-[9px] font-medium uppercase rounded px-1 py-0.5', c.type === 'inclusion' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>{c.type === 'inclusion' ? 'IN' : 'EX'}</span>
                                  <span className="text-text-secondary line-clamp-2">{c.text}</span>
                                </li>
                              ))}
                              {gc.length > 8 && <li className="text-text-muted text-[10px]">+{gc.length - 8} more</li>}
                            </ul>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ─── Main Page ───

export function PopulationExplorerPage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<PopulationProfile>(DEFAULT_PROFILE)
  const [facetFilter, setFacetFilter] = useState<FacetFilter>(EMPTY_FACET_FILTER)
  const [page, setPage] = useState(1)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [showComparison, setShowComparison] = useState(false)
  const [listOnly, setListOnly] = useState(false)

  const basket = useStudyBasket()
  const { results: allResults, isLoading, totalProfiles } = usePopulationSearch(profile)
  const { data: ontology } = useEligibilityOntology()

  // Push ontology labels into the global label resolver
  if (ontology?.labels) setOntologyLabels(ontology.labels)

  const results = useMemo(() => {
    let filtered = allResults
    if (facetFilter.groups.size > 0 || facetFilter.categories.size > 0) {
      filtered = filtered.filter((trial) => {
        const getGroup = (c: typeof trial.criteria[0]) => c.semantic_group ?? 'UNCLASSIFIED'
        for (const group of facetFilter.groups) { if (!trial.criteria.some((c) => getGroup(c) === group)) return false }
        for (const catKey of facetFilter.categories) {
          const [group, category] = catKey.split('::')
          if (!trial.criteria.some((c) => getGroup(c) === group && c.category === category)) return false
        }
        return true
      })
    }
    if (listOnly) { filtered = filtered.filter((t) => basket.has(t.profile.nct_id)) }
    return filtered
  }, [allResults, facetFilter, listOnly, basket])

  const handleProfileChange = useCallback((p: PopulationProfile) => { setProfile(p); setPage(1) }, [])
  const handleFacetChange = useCallback((f: FacetFilter) => { setFacetFilter(f); setPage(1) }, [])

  const pageResults = useMemo(() => results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [results, page])
  const totalPages = Math.ceil(results.length / PAGE_SIZE)
  const selectedForCompare = useMemo(() => showComparison ? results.filter((r) => basket.has(r.profile.nct_id)).slice(0, 5) : [], [results, basket, showComparison])

  if (isLoading) return <PageLoading message="Loading eligibility profiles..." />

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Users className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-semibold text-text-primary">Sample Populations</h1>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-4">
        {/* Left sidebar — profile only */}
        <Card className="p-3 h-fit">
          <ProfileSidebar profile={profile} onChange={handleProfileChange} matchCount={results.length} totalCount={totalProfiles} />
        </Card>

        {/* Center: everything else */}
        <div className="space-y-3">
          {/* Basket bar */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
            <ListChecks className="h-4 w-4 text-text-muted" />
            <span className="text-sm text-text-secondary"><span className="font-medium text-text-primary">{basket.count}</span> in list</span>
            <button onClick={() => basket.addAll(results.map((r) => r.profile.nct_id))} className="text-xs text-primary hover:underline ml-2">
              Add all ({results.length})
            </button>
            <button onClick={() => setListOnly(!listOnly)}
              className={cn('text-xs ml-2 px-2 py-0.5 rounded', listOnly ? 'bg-primary text-white' : 'text-primary hover:bg-primary/10')}>
              {listOnly ? 'Show all' : 'List only'}
            </button>
            {basket.count >= 2 && (
              <button onClick={() => setShowComparison(!showComparison)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline ml-2">
                <GitCompare className="h-3 w-3" /> Compare
              </button>
            )}
            <div className="flex items-center gap-2 ml-auto">
              {basket.count > 0 && (
                <button onClick={() => navigate('/samples')} className="inline-flex items-center gap-1 text-xs font-medium text-success hover:underline">
                  <TestTubes className="h-3 w-3" /> View samples
                </button>
              )}
              {basket.count > 0 && (
                <button onClick={basket.clear} className="inline-flex items-center gap-1 text-xs font-medium text-danger/70 hover:text-danger">
                  <Trash2 className="h-3 w-3" /> Clear list
                </button>
              )}
            </div>
          </div>

          {/* Active facet filter chips */}
          {(facetFilter.groups.size > 0 || facetFilter.categories.size > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-text-muted">Criteria filters:</span>
              {[...facetFilter.groups].map((g) => (
                <button key={g} onClick={() => { const n = { groups: new Set(facetFilter.groups), categories: new Set(facetFilter.categories) }; n.groups.delete(g); setFacetFilter(n) }}
                  className="inline-flex items-center gap-0.5 rounded-full bg-primary text-white px-2 py-0.5 text-[11px] font-medium hover:bg-primary/80">
                  {getGroupLabel(g)} <X className="h-2.5 w-2.5" />
                </button>
              ))}
              {[...facetFilter.categories].map((key) => {
                const [, cat] = key.split('::')
                return <button key={key} onClick={() => { const n = { groups: new Set(facetFilter.groups), categories: new Set(facetFilter.categories) }; n.categories.delete(key); setFacetFilter(n) }}
                  className="inline-flex items-center gap-0.5 rounded-full bg-accent text-white px-2 py-0.5 text-[11px] font-medium hover:bg-accent/80">
                  {cat} <X className="h-2.5 w-2.5" />
                </button>
              })}
            </div>
          )}

          {/* Comparison matrix */}
          {showComparison && selectedForCompare.length >= 2 && (
            <ComparisonMatrix trials={selectedForCompare} onClose={() => setShowComparison(false)} />
          )}

          {/* Criteria browser — full width */}
          <CriteriaBrowser facetFilter={facetFilter} onFacetChange={handleFacetChange} />

          {/* Results table */}
          <Card>
            <div className="border-b border-border px-4 py-2">
              <span className="text-sm text-text-secondary">
                {formatNumber(results.length)} trials{results.length > PAGE_SIZE && ` — page ${page} of ${totalPages}`}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-alt text-left">
                    <th className="px-2 py-2 w-8"></th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted w-20">Score</th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted w-28">Trial</th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted">Title</th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted w-16">Age</th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted w-14">ECOG</th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted w-20">Samples</th>
                    <th className="px-2 py-2 text-xs font-medium text-text-muted w-32">Exclusions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageResults.map((trial) => {
                    const p = trial.profile
                    const isExpanded = expandedRow === p.nct_id
                    const inBasket = basket.has(p.nct_id)
                    const ageStr = p.min_age && p.max_age ? `${p.min_age}–${p.max_age}` : p.min_age ? `≥${p.min_age}` : p.max_age ? `≤${p.max_age}` : '—'
                    const ecogStr = p.ecog_max !== null ? `0-${p.ecog_max}` : '—'
                    const conditions = parseArray(p.conditions)
                    const interventions = parseArray(p.interventions)
                    return (
                      <Fragment key={p.nct_id}>
                        <tr className={cn('border-t border-border cursor-pointer transition-colors', isExpanded ? 'bg-primary/5' : 'hover:bg-surface-alt', inBasket && 'bg-accent/5')}>
                          <td className="px-2 py-1.5">
                            <button onClick={(e) => { e.stopPropagation(); basket.toggle(p.nct_id) }}
                              className={cn('p-0.5 rounded', inBasket ? 'text-accent' : 'text-text-muted hover:text-primary')}
                              title={inBasket ? 'Remove from list' : 'Add to list'}>
                              <ListPlus className={cn('h-4 w-4', inBasket && 'fill-accent/20')} />
                            </button>
                          </td>
                          <td className="px-2 py-1.5" onClick={() => setExpandedRow(isExpanded ? null : p.nct_id)}><ScoreBar score={trial.matchScore} max={trial.maxScore} /></td>
                          <td className="px-2 py-1.5" onClick={() => setExpandedRow(isExpanded ? null : p.nct_id)}>
                            <Link to={`/trials/${p.nct_id}`} className="text-primary hover:underline text-xs font-medium" onClick={(e) => e.stopPropagation()}>{p.org_study_id || p.nct_id}</Link>
                            {p.org_study_id && <div className="text-[10px] text-text-muted">{p.nct_id}</div>}
                          </td>
                          <td className="px-2 py-1.5 max-w-xs" onClick={() => setExpandedRow(isExpanded ? null : p.nct_id)}>
                            <div className="text-xs text-text-primary truncate">{p.brief_title || p.title}</div>
                            <div className="flex gap-1 mt-0.5 flex-wrap">
                              {conditions.slice(0, 2).map((c) => <span key={c} className="rounded bg-surface-alt px-1 py-0.5 text-[10px] text-text-muted">{c}</span>)}
                              {interventions.slice(0, 1).map((i) => <span key={i} className="rounded bg-accent/10 px-1 py-0.5 text-[10px] text-accent">{i}</span>)}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-xs text-text-secondary" onClick={() => setExpandedRow(isExpanded ? null : p.nct_id)}>{ageStr}</td>
                          <td className="px-2 py-1.5 text-xs text-text-secondary" onClick={() => setExpandedRow(isExpanded ? null : p.nct_id)}>{ecogStr}</td>
                          <td className="px-2 py-1.5 text-xs" onClick={() => setExpandedRow(isExpanded ? null : p.nct_id)}>
                            {trial.sampleCount > 0 ? <span className="font-medium text-success">{formatNumber(trial.sampleCount)}</span> : <span className="text-text-muted">—</span>}
                          </td>
                          <td className="px-2 py-1.5" onClick={() => setExpandedRow(isExpanded ? null : p.nct_id)}>
                            <div className="flex gap-1 flex-wrap">
                              {p.hiv_excluded === true && <span className="rounded bg-danger/10 px-1 py-0.5 text-[10px] font-medium text-danger">HIV</span>}
                              {p.cns_excluded === true && <span className="rounded bg-danger/10 px-1 py-0.5 text-[10px] font-medium text-danger">CNS</span>}
                              {p.autoimmune_excluded === true && <span className="rounded bg-danger/10 px-1 py-0.5 text-[10px] font-medium text-danger">Auto</span>}
                              {p.pregnancy_excluded === true && <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">Preg</span>}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-primary/5"><td colSpan={8} className="px-4 py-3"><ExpandedDetail trial={trial} activeFacets={facetFilter} /></td></tr>
                        )}
                      </Fragment>
                    )
                  })}
                  {pageResults.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-text-muted">No trials match. Try relaxing criteria.</td></tr>}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2">
                <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="text-xs text-primary hover:underline disabled:text-text-muted">Previous</button>
                <span className="text-xs text-text-muted">Page {page} of {totalPages}</span>
                <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="text-xs text-primary hover:underline disabled:text-text-muted">Next</button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── Expanded Row Detail ───

function ExpandedDetail({ trial, activeFacets }: { trial: ScoredTrial; activeFacets: FacetFilter }) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(() => {
    for (const g of activeFacets.groups) return g
    for (const key of activeFacets.categories) return key.split('::')[0]
    return null
  })

  const groupedCriteria = useMemo(() => {
    const groups = new Map<string, Criterion[]>()
    for (const c of trial.criteria) { const g = c.semantic_group ?? 'UNCLASSIFIED'; if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(c) }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [trial.criteria])

  return (
    <div className="space-y-3">
      {trial.matches.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-text-secondary mb-1">Match Details</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {trial.matches.map((m) => (
              <div key={m.field} className="flex items-center gap-2 text-xs">
                <MatchIcon status={m.status} />
                <span className="text-text-secondary">{m.label}:</span>
                <span className="text-text-primary font-medium">{m.trialValue}</span>
                <span className="text-text-muted">(want: {m.requiredValue})</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <h4 className="text-xs font-semibold text-text-secondary mb-1">Criteria ({trial.criteria.length} total, {groupedCriteria.length} groups)</h4>
        <div className="space-y-0.5">
          {groupedCriteria.map(([group, criteria]) => {
            const isActive = activeFacets.groups.has(group) || [...activeFacets.categories].some((k) => k.startsWith(group + '::'))
            return (
              <div key={group}>
                <button onClick={() => setExpandedGroup(expandedGroup === group ? null : group)}
                  className={cn('flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs hover:bg-surface-alt/50 transition-colors', isActive && 'bg-primary/5')}>
                  {expandedGroup === group ? <ChevronDown className="h-3 w-3 text-text-muted" /> : <ChevronRight className="h-3 w-3 text-text-muted" />}
                  <span className={cn('font-medium', isActive ? 'text-primary' : 'text-text-primary')}>{getGroupLabel(group)}</span>
                  <span className="text-text-muted">({criteria.length})</span>
                </button>
                {expandedGroup === group && (
                  <div className="ml-5 space-y-1 mb-2">
                    {criteria.map((c, i) => (
                      <div key={i} className="flex gap-1.5 text-xs">
                        <span className={cn('flex-shrink-0 text-[9px] font-medium uppercase rounded px-1 py-0.5 mt-0.5', c.type === 'inclusion' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger')}>{c.type === 'inclusion' ? 'IN' : 'EX'}</span>
                        <span className="text-text-secondary">{c.text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {trial.profile.eligibility_criteria && <RawEligibilityText text={trial.profile.eligibility_criteria} />}
    </div>
  )
}

function RawEligibilityText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-text-primary">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <FileText className="h-3 w-3" /> Original eligibility text
      </button>
      {open && <pre className="mt-1 max-h-60 overflow-y-auto rounded bg-surface-alt p-3 text-xs text-text-secondary whitespace-pre-wrap font-sans leading-relaxed">{text}</pre>}
    </div>
  )
}
