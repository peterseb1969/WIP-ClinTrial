import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'
import { type SqlQuery } from '@/components/SqlInspector'

export interface TANode {
  value: string
  label: string
  children: TANode[]
}

const TA_TERMINOLOGY_SQL = `SELECT DISTINCT terminology_id FROM terms
         WHERE terminology_value = 'CT_THERAPEUTIC_AREA' AND status = 'active'
         LIMIT 1`

const TA_RELATIONSHIPS_SQL = `SELECT DISTINCT source_term_value as source, target_term_value as target
         FROM term_relationships
         WHERE relationship_type = 'is_a'
         AND source_terminology_id = target_terminology_id
         AND source_terminology_id = $1`

export const taTreeQueries: SqlQuery[] = [
  { label: 'TA Terminology Lookup', sql: TA_TERMINOLOGY_SQL, params: [] },
  { label: 'TA Ontology Relationships', sql: TA_RELATIONSHIPS_SQL, params: ['(resolved terminology_id)'] },
]

/** Fetch the therapeutic area ontology tree from term_relationships */
export function useTherapeuticAreaTree() {
  return useQuery<TANode[]>({
    queryKey: ['clintrial', 'ta-tree'],
    queryFn: async () => {
      const termResult = await reportQuery<{ terminology_id: string }>(TA_TERMINOLOGY_SQL)
      const taTerminologyId = termResult.rows[0]?.terminology_id
      if (!taTerminologyId) return []

      const result = await reportQuery<{ source: string; target: string }>(
        TA_RELATIONSHIPS_SQL, [taTerminologyId],
      )

      // Build adjacency: parent → children
      const childrenOf = new Map<string, Set<string>>()
      const hasParent = new Set<string>()

      for (const row of result.rows) {
        if (!childrenOf.has(row.target)) childrenOf.set(row.target, new Set())
        childrenOf.get(row.target)!.add(row.source)
        hasParent.add(row.source)
      }

      // Roots: appear as targets but not as sources (no parent)
      const allTargets = new Set(result.rows.map((r) => r.target))
      const roots = [...allTargets].filter((t) => !hasParent.has(t)).sort()

      function buildNode(value: string): TANode {
        const children = [...(childrenOf.get(value) ?? [])].sort()
        return {
          value,
          label: value.replace(/_/g, ' '),
          children: children.map(buildNode),
        }
      }

      return roots.map(buildNode)
    },
    staleTime: 30 * 60 * 1000,
  })
}
