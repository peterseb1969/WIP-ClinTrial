/**
 * Therapeutic Area ontology loader.
 *
 * Reads is_a relationships from the reporting SQL term_relations table
 * and builds a transitive-closure ancestor map keyed by child TA value.
 *
 * Used by the classifier to propagate matched leaf TAs to their ancestors
 * (e.g. matching BREAST_CANCER also adds ONCOLOGY).
 */

import { reportQuery } from './wip-api.js'

const TA_TERMINOLOGY_SQL = `SELECT DISTINCT terminology_id FROM terms
         WHERE terminology_value = 'CT_THERAPEUTIC_AREA' AND status = 'active'
         LIMIT 1`

const TA_RELATIONSHIPS_SQL = `SELECT DISTINCT source_term_value AS source, target_term_value AS target
         FROM term_relations
         WHERE relation_type = 'is_a'
         AND source_terminology_id = target_terminology_id
         AND source_terminology_id = $1`

/**
 * Load a map from each TA value to the set of its transitive is_a ancestors.
 * Returns an empty map if the ontology is missing or the query fails (silent fallback).
 */
export async function loadTAAncestors(): Promise<Map<string, Set<string>>> {
  try {
    const termResult = await reportQuery<{ terminology_id: string }>(TA_TERMINOLOGY_SQL)
    const taTerminologyId = termResult.rows[0]?.terminology_id
    if (!taTerminologyId) return new Map()

    const relResult = await reportQuery<{ source: string; target: string }>(
      TA_RELATIONSHIPS_SQL,
      [taTerminologyId],
    )

    // Build direct parent adjacency: child -> direct parents
    const directParents = new Map<string, Set<string>>()
    for (const row of relResult.rows) {
      if (!directParents.has(row.source)) directParents.set(row.source, new Set())
      directParents.get(row.source)!.add(row.target)
    }

    // Compute transitive closure via memoised DFS with a visited guard for cycles
    const ancestors = new Map<string, Set<string>>()

    function walk(node: string, stack: Set<string>): Set<string> {
      const cached = ancestors.get(node)
      if (cached) return cached
      if (stack.has(node)) return new Set() // cycle guard
      stack.add(node)

      const result = new Set<string>()
      const parents = directParents.get(node)
      if (parents) {
        for (const parent of parents) {
          result.add(parent)
          for (const a of walk(parent, stack)) result.add(a)
        }
      }
      stack.delete(node)
      ancestors.set(node, result)
      return result
    }

    for (const child of directParents.keys()) {
      walk(child, new Set())
    }

    return ancestors
  } catch (err) {
    console.warn('Failed to load TA ontology, falling back to flat classification:', err)
    return new Map()
  }
}
