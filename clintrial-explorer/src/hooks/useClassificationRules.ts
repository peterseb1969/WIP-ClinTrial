import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

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


/** Fetch all classification rules from WIP document-store (not reporting SQL — need real-time status) */
export function useClassificationRules() {
  return useQuery<ClassificationRule[]>({
    queryKey: ['clintrial', 'classification-rules'],
    queryFn: async () => {
      const templateId = await resolveTemplateId()
      if (!templateId) return []

      const res = await fetch(
        `/api/document-store/documents/query`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: templateId,
            status: 'active',
            page_size: 100,
          }),
        },
      )
      if (!res.ok) return []
      const data = await res.json()
      const items = data.items ?? data.results ?? data ?? []
      if (!Array.isArray(items)) return []

      return items.map((doc: Record<string, unknown>) => {
        const d = (doc.data ?? doc) as Record<string, unknown>
        return {
          document_id: (doc.document_id ?? doc.id ?? '') as string,
          rule_type: (d.rule_type as string) || 'CONDITION_TO_TA',
          pattern: (d.pattern as string) || '',
          match_type: (d.match_type as string) || 'CONTAINS',
          action: (d.action as string) || 'ADD',
          target_ta: (d.target_ta as string) || '',
          priority: (d.priority as number) ?? 0,
          enabled: (d.enabled as boolean) ?? true,
          notes: (d.notes as string) || null,
          trial_nct_id: (d.trial_nct_id as string) || null,
        }
      }).sort((a: ClassificationRule, b: ClassificationRule) => b.priority - a.priority || a.pattern.localeCompare(b.pattern))
    },
    staleTime: 2 * 60 * 1000,
  })
}

/** Apply classification rules to a list of conditions.
 * Returns the set of TAs to add and remove.
 */
export function applyRules(
  conditions: string[],
  rules: ClassificationRule[],
  nctId?: string,
): { add: Set<string>; remove: Set<string> } {
  const add = new Set<string>()
  const remove = new Set<string>()

  const enabledRules = rules.filter((r) => r.enabled && r.rule_type === 'CONDITION_TO_TA')

  for (const condition of conditions) {
    const condLower = condition.toLowerCase()

    for (const rule of enabledRules) {
      // Skip trial-specific rules that don't match this trial
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
            matches = new RegExp(`\\b${patternLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(condLower)
          } catch {
            matches = false
          }
          break
        // REGEX not implemented in frontend yet
        default:
          matches = condLower.includes(patternLower)
      }

      if (matches) {
        if (rule.action === 'REMOVE') {
          remove.add(rule.target_ta)
        } else {
          add.add(rule.target_ta)
        }
      }
    }
  }

  return { add, remove }
}

/** Enrich a trial's therapeutic areas using classification rules */
export function enrichTherapeuticAreas(
  storedTAs: string[] | undefined,
  conditions: string[] | undefined,
  rules: ClassificationRule[],
  nctId?: string,
): string[] {
  const base = new Set(storedTAs || [])
  if (!conditions || rules.length === 0) return [...base]

  const { add, remove } = applyRules(conditions, rules, nctId)
  for (const ta of add) base.add(ta)
  for (const ta of remove) base.delete(ta)
  return [...base].sort()
}

/** Resolve template ID for CT_CLASSIFICATION_RULE */
let _cachedTemplateId: string | null = null
async function resolveTemplateId(): Promise<string | null> {
  if (_cachedTemplateId) return _cachedTemplateId
  try {
    const res = await fetch(
      '/api/template-store/templates/by-value/CT_CLASSIFICATION_RULE?namespace=clintrial',
    )
    if (!res.ok) return null
    const data = await res.json()
    _cachedTemplateId = data.template_id
    return _cachedTemplateId
  } catch {
    return null
  }
}

/** Create a new classification rule */
export function useCreateRule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (rule: Omit<ClassificationRule, 'document_id'>) => {
      const templateId = await resolveTemplateId()
      if (!templateId) throw new Error('CT_CLASSIFICATION_RULE template not found')

      const res = await fetch('/api/document-store/documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          template_id: templateId,
          template_version: 1,
          namespace: 'clintrial',
          data: {
            rule_type: rule.rule_type,
            pattern: rule.pattern,
            match_type: rule.match_type,
            action: rule.action,
            target_ta: rule.target_ta,
            priority: rule.priority,
            enabled: rule.enabled,
            notes: rule.notes,
            trial_nct_id: rule.trial_nct_id,
          },
        }]),
      })
      if (!res.ok) throw new Error(`Failed to create rule: ${res.status}`)
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clintrial', 'classification-rules'] })
    },
  })
}

/** Delete a classification rule (deactivate) */
export function useDeleteRule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (documentId: string) => {
      const res = await fetch('/api/document-store/documents/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ id: documentId }]),
      })
      if (!res.ok) throw new Error(`Failed to delete rule: ${res.status}`)
      return { documentId }
    },
    onMutate: async (documentId) => {
      // Optimistic update: remove the rule from cache immediately
      await queryClient.cancelQueries({ queryKey: ['clintrial', 'classification-rules'] })
      const previous = queryClient.getQueryData<ClassificationRule[]>(['clintrial', 'classification-rules'])
      queryClient.setQueryData<ClassificationRule[]>(
        ['clintrial', 'classification-rules'],
        (old) => old?.filter((r) => r.document_id !== documentId) ?? [],
      )
      return { previous }
    },
    onError: (_err, _documentId, context) => {
      // Rollback on error
      if (context?.previous) {
        queryClient.setQueryData(['clintrial', 'classification-rules'], context.previous)
      }
    },
    onSettled: () => {
      // Refetch after a delay to let reporting-sync catch up
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['clintrial', 'classification-rules'] })
      }, 3000)
    },
  })
}
