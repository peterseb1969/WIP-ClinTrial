import { Router } from 'express'
import {
  reportQuery,
  resolveTerminologyId,
  createTerms,
  updateTermAliases,
  deleteTermById,
} from '../lib/wip-api.js'
import { callClaude, extractJson } from '../lib/anthropic.js'

const router = Router()

const AE_TERMINOLOGY_VALUE = 'CT_AE_TERM'

interface TermRow {
  term_id: string
  value: string
  label: string
  aliases: string | null
}

interface RawTermRow {
  term: string
  trial_count: number
  report_count: number
}

interface ExistingTerm {
  term_id: string
  canonical: string
  aliases: string[]
}

interface Cluster {
  canonical: string
  variants: string[]
  confidence: number
  reason: string
  /** Matches an existing canonical (if any) so the apply step can add aliases to it. */
  existing_canonical?: string | null
}

/**
 * Salvage complete cluster objects from a truncated JSON array response.
 * Strategy: strip markdown fence, find each top-level `{...}` object via brace
 * tracking, parse each one individually, skip any that fail.
 */
function salvageTruncatedClusters(text: string): Cluster[] {
  let body = text
  const fenced = body.match(/```(?:json)?\s*([\s\S]*)/)
  if (fenced) body = fenced[1]
  const arrStart = body.indexOf('[')
  if (arrStart >= 0) body = body.slice(arrStart + 1)

  const out: Cluster[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escape = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        const chunk = body.slice(start, i + 1)
        try {
          out.push(JSON.parse(chunk) as Cluster)
        } catch {
          /* skip malformed object */
        }
        start = -1
      }
    }
  }
  return out
}

/**
 * Collapse case-only variants before sending to Claude.
 * Returns:
 *   - `groups`: representative term (most frequent spelling) → { variants[], totalCount }
 *   - `caseClusters`: auto-generated clusters for groups that had 2+ case variants
 *
 * This saves massive amounts of Claude tokens since case-only variants are trivial.
 */
function collapseCaseVariants(rawTerms: RawTermRow[]): {
  reps: RawTermRow[]
  caseClusters: Cluster[]
} {
  const byLower = new Map<string, RawTermRow[]>()
  for (const r of rawTerms) {
    const key = r.term.toLowerCase()
    if (!byLower.has(key)) byLower.set(key, [])
    byLower.get(key)!.push(r)
  }

  const reps: RawTermRow[] = []
  const caseClusters: Cluster[] = []
  for (const group of byLower.values()) {
    // Representative = highest trial_count
    group.sort((a, b) => b.trial_count - a.trial_count)
    const rep = group[0]
    const totalTrials = group.reduce((s, g) => s + g.trial_count, 0)
    reps.push({ ...rep, trial_count: totalTrials })
    if (group.length >= 2) {
      caseClusters.push({
        canonical: rep.term,
        variants: group.map((g) => g.term),
        confidence: 1.0,
        reason: 'Case-only variants (auto-clustered).',
        existing_canonical: null,
      })
    }
  }
  return { reps, caseClusters }
}

/** Fetch all active CT_AE_TERM terms with their aliases. */
async function loadExistingTerms(terminologyId: string): Promise<ExistingTerm[]> {
  const result = await reportQuery<TermRow>(
    `SELECT term_id, value, label, aliases
     FROM terms
     WHERE terminology_id = $1 AND status = 'active'`,
    [terminologyId],
    10000,
  )
  return result.rows.map((r) => {
    let aliases: string[] = []
    try {
      aliases = r.aliases ? JSON.parse(r.aliases) : []
    } catch {
      /* ignore */
    }
    return { term_id: r.term_id, canonical: r.value, aliases }
  })
}

/** Fetch all distinct AE term strings from doc_ct_trial_ae with frequency. */
async function loadRawAETerms(): Promise<RawTermRow[]> {
  const result = await reportQuery<RawTermRow>(
    `SELECT term,
            COUNT(DISTINCT nct_id)::int AS trial_count,
            COUNT(*)::int AS report_count
     FROM doc_ct_trial_ae
     WHERE status = 'active' AND term IS NOT NULL AND term != ''
     GROUP BY term
     ORDER BY trial_count DESC`,
    [],
    20000,
  )
  return result.rows
}

const CLEANUP_SYSTEM_PROMPT = `You are a clinical data curator specializing in adverse event (AE) terminology. Your job is to cluster raw AE term strings by semantic equivalence.

Case-only variants have ALREADY been collapsed before reaching you — do NOT spend output tokens clustering terms that differ only in capitalization.

Cluster terms that are:
- Spelling variants or typos ("headache" / "haedache" / "head ache")
- Pluralizations ("headache" / "headaches")
- Word-order variants ("pain back" / "back pain")
- Common abbreviations ("HTN" / "hypertension"; "N/V" / "nausea and vomiting")
- Obvious MedDRA-style synonyms ("pyrexia" / "fever"; "emesis" / "vomiting")
- Punctuation/whitespace variants ("nausea, vomiting" / "nausea and vomiting")

DO NOT cluster terms that represent:
- Distinct conditions with similar names ("hypertension" ≠ "hypotension", "hyperglycemia" ≠ "hypoglycemia")
- Different anatomical sites ("left knee pain" ≠ "right knee pain" unless the policy is to merge lateralities — assume NO)
- Different severities or qualifiers ("mild headache" ≠ "severe headache")
- Related but not equivalent terms ("fatigue" ≠ "weakness", "dyspnea" ≠ "cough")
- Single-condition combos that should stay separate ("nausea" ≠ "nausea and vomiting")

For each cluster:
1. Pick the highest-frequency variant as the "canonical" form. If frequencies tie, pick the most standard/formal spelling.
2. If an existing canonical already covers this concept, set "existing_canonical" to that canonical value and make "canonical" equal to it — the apply step will add the variants as aliases to the existing term.
3. Include ONLY the variants that are clearly equivalent. When in doubt, LEAVE IT OUT and make a separate cluster.
4. Assign confidence 0.0-1.0 based on how certain you are all variants belong together.
5. Provide a one-sentence "reason" explaining the clustering rationale.

Output a JSON array. Do NOT include clusters of size 1 (nothing to merge). Do NOT include prose outside the JSON. The JSON schema is:

[
  {
    "canonical": "headache",
    "variants": ["headache", "headaches", "Headache", "haedache"],
    "existing_canonical": null,
    "confidence": 0.98,
    "reason": "Spelling and capitalization variants of the same symptom."
  }
]

If no clusters are worth merging, return [].`

function buildUserMessage(
  rawTerms: RawTermRow[],
  existing: ExistingTerm[],
): string {
  const rawLines = rawTerms
    .map((r) => `${r.term}\t${r.trial_count}\t${r.report_count}`)
    .join('\n')

  const existingLines = existing
    .slice(0, 500)
    .map((e) =>
      e.aliases.length > 0
        ? `${e.canonical}\t[aliases: ${e.aliases.join(', ')}]`
        : e.canonical,
    )
    .join('\n')

  return `EXISTING CANONICAL TERMS (already curated — prefer attaching variants to these):
${existingLines || '(none)'}

---

RAW AE TERM STRINGS (format: term\\ttrial_count\\treport_count):
${rawLines}

Cluster the raw strings above and return the JSON array as specified. Remember: no clusters of size 1, no prose outside JSON.`
}

/**
 * GET /server-api/ae-cleanup/stats
 * Cheap counts-only endpoint — no Claude call, no cost. Lets the UI show
 * the "N raw → M canonical" story and preview what a propose run would
 * look like before spending any tokens.
 */
router.get('/ae-cleanup/stats', async (_req, res) => {
  try {
    const terminologyId = await resolveTerminologyId(AE_TERMINOLOGY_VALUE)
    const [existing, rawTerms] = await Promise.all([
      loadExistingTerms(terminologyId),
      loadRawAETerms(),
    ])
    const aliasedSet = new Set<string>()
    for (const t of existing) {
      aliasedSet.add(t.canonical.toLowerCase())
      for (const a of t.aliases) aliasedSet.add(a.toLowerCase())
    }
    const unmapped = rawTerms.filter((r) => !aliasedSet.has(r.term.toLowerCase()))
    const lowerSet = new Set(unmapped.map((r) => r.term.toLowerCase()))
    res.json({
      raw_term_count: rawTerms.length,
      existing_term_count: existing.length,
      unmapped_count: unmapped.length,
      case_collapsed_count: unmapped.length - lowerSet.size,
      unique_lowercase_count: lowerSet.size,
    })
  } catch (e) {
    console.error('[ae-cleanup/stats] error:', e)
    res.status(500).json({ error: String(e) })
  }
})

/**
 * POST /server-api/ae-cleanup/propose
 * Returns: { clusters: Cluster[], stats: {...} }
 */
router.post('/ae-cleanup/propose', async (_req, res) => {
  const t0 = Date.now()
  try {
    console.log('[ae-cleanup/propose] start')
    const terminologyId = await resolveTerminologyId(AE_TERMINOLOGY_VALUE)
    console.log(`[ae-cleanup/propose] resolved terminology in ${Date.now() - t0}ms`)
    const [existing, rawTerms] = await Promise.all([
      loadExistingTerms(terminologyId),
      loadRawAETerms(),
    ])
    console.log(
      `[ae-cleanup/propose] loaded ${existing.length} existing, ${rawTerms.length} raw in ${Date.now() - t0}ms`,
    )

    // Build a set of already-aliased strings (case-insensitive) so we can mark them
    const aliasedSet = new Set<string>()
    for (const t of existing) {
      aliasedSet.add(t.canonical.toLowerCase())
      for (const a of t.aliases) aliasedSet.add(a.toLowerCase())
    }

    // Only send raw terms that aren't already resolved to an existing term
    const unmapped = rawTerms.filter((r) => !aliasedSet.has(r.term.toLowerCase()))

    // Pre-collapse case-only variants — these are trivial and would waste Claude tokens
    const { reps, caseClusters } = collapseCaseVariants(unmapped)
    console.log(
      `[ae-cleanup/propose] collapsed ${unmapped.length} → ${reps.length} representatives (${caseClusters.length} case-only clusters)`,
    )

    if (reps.length === 0) {
      res.json({
        clusters: caseClusters,
        stats: {
          raw_term_count: rawTerms.length,
          existing_term_count: existing.length,
          unmapped_count: unmapped.length,
          case_clusters: caseClusters.length,
          usage: null,
        },
      })
      return
    }

    // Re-sort representatives by frequency (top-down) and cap to protect the model budget.
    reps.sort((a, b) => b.trial_count - a.trial_count)
    const MAX_TERMS = 3000
    const toSend = reps.slice(0, MAX_TERMS)

    const userMessage = buildUserMessage(toSend, existing)
    console.log(
      `[ae-cleanup/propose] sending ${toSend.length} unmapped terms to Claude (prompt ${userMessage.length} chars)`,
    )
    const { text, usage } = await callClaude({
      system: CLEANUP_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 32000,
      temperature: 0,
    })

    console.log(
      `[ae-cleanup/propose] Claude returned ${text.length} chars in ${Date.now() - t0}ms (usage: ${usage.input_tokens} in, ${usage.output_tokens} out)`,
    )
    let clusters: Cluster[] = []
    let parseTruncated = false
    try {
      clusters = extractJson<Cluster[]>(text)
    } catch {
      // Claude may have hit the token limit and produced truncated JSON.
      // Try to salvage complete cluster objects.
      parseTruncated = true
      clusters = salvageTruncatedClusters(text)
      if (clusters.length === 0) {
        res.status(500).json({
          error: 'Failed to parse Claude response as JSON (no salvageable clusters)',
          raw_response: text.slice(0, 2000),
        })
        return
      }
      console.log(`[ae-cleanup/propose] salvaged ${clusters.length} clusters from truncated JSON`)
    }

    // Normalize + filter: drop singletons, dedupe variants within a cluster
    const claudeClusters = clusters
      .filter((c) => Array.isArray(c.variants) && c.variants.length >= 2)
      .map((c) => ({
        canonical: String(c.canonical || c.variants[0]),
        variants: [...new Set(c.variants.map(String))],
        confidence: Number(c.confidence) || 0,
        reason: String(c.reason || ''),
        existing_canonical: c.existing_canonical ? String(c.existing_canonical) : null,
      }))

    // Prepend case-collapse clusters (they're high-confidence and already verified)
    const allClusters = [...caseClusters, ...claudeClusters]

    res.json({
      clusters: allClusters,
      stats: {
        raw_term_count: rawTerms.length,
        existing_term_count: existing.length,
        unmapped_count: unmapped.length,
        case_clusters: caseClusters.length,
        sent_to_claude: toSend.length,
        truncated: reps.length > MAX_TERMS || parseTruncated,
        usage,
      },
    })
  } catch (e) {
    console.error('[ae-cleanup/propose] error:', e)
    res.status(500).json({ error: String(e) })
  }
})

/**
 * POST /server-api/ae-cleanup/apply
 * Body: { clusters: Cluster[] }  (only the clusters the user approved)
 * Applies each cluster: adds aliases to existing term or creates a new term.
 * Does NOT delete orphan terms (caller can do that separately if desired).
 */
router.post('/ae-cleanup/apply', async (req, res) => {
  try {
    const body = req.body as { clusters?: Cluster[] }
    const clusters = body.clusters ?? []
    if (clusters.length === 0) {
      res.json({ applied: 0, created: 0, updated: 0, errors: [] })
      return
    }

    const terminologyId = await resolveTerminologyId(AE_TERMINOLOGY_VALUE)
    const existing = await loadExistingTerms(terminologyId)

    // Build canonical → ExistingTerm map (case-insensitive)
    const byCanonical = new Map<string, ExistingTerm>()
    for (const t of existing) byCanonical.set(t.canonical.toLowerCase(), t)

    // Build raw-variant → term_id map for deleting redundant term docs after merge
    const variantToTermId = new Map<string, string>()
    for (const t of existing) {
      variantToTermId.set(t.canonical.toLowerCase(), t.term_id)
      for (const a of t.aliases) variantToTermId.set(a.toLowerCase(), t.term_id)
    }

    let created = 0
    let updated = 0
    let deleted = 0
    const errors: Array<{ cluster: string; error: string }> = []

    for (const cluster of clusters) {
      const canonicalKey = (cluster.existing_canonical || cluster.canonical).toLowerCase()
      const existingTerm = byCanonical.get(canonicalKey)

      // Variants to add as aliases (exclude the canonical itself)
      const newAliases = cluster.variants.filter(
        (v) => v.toLowerCase() !== canonicalKey,
      )

      try {
        if (existingTerm) {
          // Merge with existing term: union of existing aliases + new variants
          const mergedAliases = [
            ...new Set([...existingTerm.aliases, ...newAliases]),
          ]
          await updateTermAliases(existingTerm.term_id, mergedAliases)
          updated++

          // Delete any redundant term docs that happen to match a variant we just aliased
          for (const v of newAliases) {
            const redundantId = variantToTermId.get(v.toLowerCase())
            if (redundantId && redundantId !== existingTerm.term_id) {
              try {
                await deleteTermById(redundantId)
                deleted++
              } catch {
                /* non-critical */
              }
            }
          }
        } else {
          // Create new canonical term with the variants as aliases
          await createTerms(terminologyId, [
            {
              value: cluster.canonical,
              label: cluster.canonical,
              aliases: newAliases,
            },
          ])
          created++

          // Delete any redundant term docs for the variants (including the canonical if it was a separate term)
          for (const v of [cluster.canonical, ...newAliases]) {
            const redundantId = variantToTermId.get(v.toLowerCase())
            if (redundantId) {
              try {
                await deleteTermById(redundantId)
                deleted++
              } catch {
                /* non-critical */
              }
            }
          }
        }
      } catch (e) {
        errors.push({ cluster: cluster.canonical, error: String(e) })
      }
    }

    res.json({
      applied: created + updated,
      created,
      updated,
      deleted,
      errors,
    })
  } catch (e) {
    console.error('[ae-cleanup/apply] error:', e)
    res.status(500).json({ error: String(e) })
  }
})

export default router
