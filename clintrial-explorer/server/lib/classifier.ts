/**
 * Server-side classification engine.
 * Ports applyRules/enrichTherapeuticAreas from client-side hooks to server.
 * Adds provenance tracking for transparency.
 */

export interface ClassificationRule {
  document_id: string
  rule_type: string
  pattern: string
  match_type: string
  action: string
  target_ta: string
  priority: number
  enabled: boolean
  notes: string | null
  trial_nct_id: string | null
}

export interface RuleMatch {
  rule_document_id: string
  rule_pattern: string
  match_type: string
  action: string
  matched_condition: string
  target_ta: string
  /** If set, this TA was inherited from an ancestor walk, not matched directly.
   * Value is the leaf TA that produced this ancestor. */
  inherited_from?: string
}

export interface ClassificationResult {
  nct_id: string
  document_id: string
  old_tas: string[]
  new_tas: string[]
  provenance: RuleMatch[]
  pinned: boolean
  changed: boolean
}

/** Apply rules to a list of conditions with provenance tracking */
export function applyRulesWithProvenance(
  conditions: string[],
  rules: ClassificationRule[],
  nctId?: string,
): { add: Set<string>; remove: Set<string>; provenance: RuleMatch[] } {
  const add = new Set<string>()
  const remove = new Set<string>()
  const provenance: RuleMatch[] = []

  const enabledRules = rules.filter((r) => r.enabled && r.rule_type === 'CONDITION_TO_TA')

  for (const condition of conditions) {
    const condLower = condition.toLowerCase()

    for (const rule of enabledRules) {
      if (rule.trial_nct_id && rule.trial_nct_id !== nctId) continue

      const patternLower = rule.pattern.toLowerCase()
      let matches = false

      switch (rule.match_type) {
        case 'EXACT':
          matches = condLower === patternLower
          break
        case 'CONTAINS':
          matches = condLower.includes(patternLower)
          break
        case 'WORD_BOUNDARY':
          try {
            const escaped = patternLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            matches = new RegExp(`\\b${escaped}\\b`).test(condLower)
          } catch {
            matches = false
          }
          break
        case 'REGEX':
          try {
            matches = new RegExp(rule.pattern, 'i').test(condition)
          } catch {
            matches = false
          }
          break
        default:
          matches = condLower.includes(patternLower)
      }

      if (matches) {
        const match: RuleMatch = {
          rule_document_id: rule.document_id,
          rule_pattern: rule.pattern,
          match_type: rule.match_type,
          action: rule.action,
          matched_condition: condition,
          target_ta: rule.target_ta,
        }
        provenance.push(match)

        if (rule.action === 'REMOVE') {
          remove.add(rule.target_ta)
        } else {
          add.add(rule.target_ta)
        }
      }
    }
  }

  return { add, remove, provenance }
}

export interface TrialForClassification {
  document_id: string
  nct_id: string
  title: string
  status: string
  study_type: string
  sponsor: string
  therapeutic_areas: string[]
  ta_pinned: boolean
  conditions: string[]
  // All fields needed for upsert
  [key: string]: unknown
}

/**
 * Walk is_a ancestors for a set of leaf TAs and return the inherited additions
 * along with per-ancestor provenance. Only applies to ADD (not REMOVE).
 */
export function walkAncestors(
  leaves: Set<string>,
  ancestorMap: Map<string, Set<string>>,
  matchedConditionByLeaf: Map<string, string>,
): { inherited: Set<string>; provenance: RuleMatch[] } {
  const inherited = new Set<string>()
  const provenance: RuleMatch[] = []

  for (const leaf of leaves) {
    const ancestors = ancestorMap.get(leaf)
    if (!ancestors) continue
    for (const ancestor of ancestors) {
      if (leaves.has(ancestor) || inherited.has(ancestor)) continue
      inherited.add(ancestor)
      provenance.push({
        rule_document_id: '',
        rule_pattern: `is_a: ${leaf}`,
        match_type: 'ONTOLOGY',
        action: 'ADD',
        matched_condition: matchedConditionByLeaf.get(leaf) ?? leaf,
        target_ta: ancestor,
        inherited_from: leaf,
      })
    }
  }

  return { inherited, provenance }
}

/** Classify a set of trials using rules. Returns results with provenance.
 * If ancestorMap is provided, matched leaf TAs are expanded with their
 * transitive is_a ancestors and tagged in provenance as inherited. */
export function classifyTrials(
  trials: TrialForClassification[],
  rules: ClassificationRule[],
  ancestorMap?: Map<string, Set<string>>,
): ClassificationResult[] {
  const results: ClassificationResult[] = []

  for (const trial of trials) {
    if (trial.ta_pinned) {
      results.push({
        nct_id: trial.nct_id,
        document_id: trial.document_id,
        old_tas: trial.therapeutic_areas,
        new_tas: trial.therapeutic_areas,
        provenance: [],
        pinned: true,
        changed: false,
      })
      continue
    }

    const base = new Set(trial.therapeutic_areas || [])
    const conditions = trial.conditions || []

    const { add, remove, provenance } =
      conditions.length === 0
        ? { add: new Set<string>(), remove: new Set<string>(), provenance: [] as RuleMatch[] }
        : applyRulesWithProvenance(conditions, rules, trial.nct_id)

    const newTAs = new Set(base)
    for (const ta of add) newTAs.add(ta)
    for (const ta of remove) newTAs.delete(ta)

    // Ontology walk: add transitive is_a ancestors of every TA in the final set.
    // Runs AFTER remove so a removed leaf doesn't contribute ancestors.
    // REMOVE does not cascade down — explicit leaf-level control.
    if (ancestorMap && ancestorMap.size > 0 && newTAs.size > 0) {
      // Record one representative condition per matched leaf for provenance.
      // Baseline/keyword-sourced leaves fall back to '(baseline)'.
      const conditionByLeaf = new Map<string, string>()
      for (const p of provenance) {
        if (p.action === 'ADD' && !conditionByLeaf.has(p.target_ta)) {
          conditionByLeaf.set(p.target_ta, p.matched_condition)
        }
      }
      for (const leaf of newTAs) {
        if (!conditionByLeaf.has(leaf)) conditionByLeaf.set(leaf, '(baseline)')
      }
      const { inherited, provenance: inheritedProv } = walkAncestors(
        newTAs,
        ancestorMap,
        conditionByLeaf,
      )
      for (const ta of inherited) newTAs.add(ta)
      provenance.push(...inheritedProv)
    }
    const newTAsSorted = [...newTAs].sort()
    const oldTAsSorted = [...base].sort()

    const changed =
      newTAsSorted.length !== oldTAsSorted.length ||
      newTAsSorted.some((ta, i) => ta !== oldTAsSorted[i])

    results.push({
      nct_id: trial.nct_id,
      document_id: trial.document_id,
      old_tas: oldTAsSorted,
      new_tas: newTAsSorted,
      provenance,
      pinned: false,
      changed,
    })
  }

  return results
}
