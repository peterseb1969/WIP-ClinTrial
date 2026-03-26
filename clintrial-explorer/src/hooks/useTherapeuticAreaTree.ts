import { useQuery } from '@tanstack/react-query'
import { reportQuery } from '@/lib/reporting'

export interface TANode {
  value: string
  label: string
  children: TANode[]
}

/** Fetch the therapeutic area ontology tree from term_relationships */
export function useTherapeuticAreaTree() {
  return useQuery<TANode[]>({
    queryKey: ['clintrial', 'ta-tree'],
    queryFn: async () => {
      // Fetch all is_a relationships where both sides are in CT_THERAPEUTIC_AREA
      // or where the target is a TA term (for cross-terminology relationships)
      const result = await reportQuery<{
        source: string
        target: string
      }>(
        `SELECT source_term_value as source, target_term_value as target
         FROM term_relationships
         WHERE relationship_type = 'is_a'
         AND source_term_value IN (
           SELECT source_term_value FROM term_relationships
           WHERE relationship_type = 'is_a'
         )`,
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

      // Build tree recursively
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
    staleTime: 30 * 60 * 1000, // Ontology doesn't change often
  })
}
