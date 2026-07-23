/**
 * Self-contained bootstrap: creates the clintrial namespace, terminologies,
 * terms, ontology relationships, and templates from embedded seed data.
 */

import { wipGet, wipPost, wipPut } from './wip-api.js'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEED_DIR = join(__dirname, '..', 'seed')
const NAMESPACE = 'clintrial'
// Namespace-prefixed bootstrap-record value (CASE-757): every app minting the
// same literal BOOTSTRAP_RECORD made app-to-app namespace merges collide on
// that one template. The seed file MUST declare this same value. Field shape
// stays canonical. Namespaces bootstrapped before this change keep their
// unprefixed template — never rename in place (value = identity).
const BOOTSTRAP_RECORD_VALUE = `${NAMESPACE.toUpperCase().replace(/-/g, '_')}_BOOTSTRAP_RECORD`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

export type BootstrapStatus = 'unknown' | 'wip_unreachable' | 'needs_bootstrap' | 'ready'

export interface BootstrapProgress {
  step: string
  detail: string
  done: boolean
  error?: string
}

/** Check if WIP is reachable and whether the clintrial namespace exists */
export async function checkStatus(): Promise<BootstrapStatus> {
  // Use namespace listing as health probe — no dedicated /health endpoint
  let namespaces: Array<{ prefix: string }>
  try {
    namespaces = (await wipGet('/api/registry/namespaces')) as Array<{ prefix: string }>
  } catch {
    return 'wip_unreachable'
  }

  if (namespaces.some((ns) => ns.prefix === NAMESPACE)) {
    try {
      const templates = (await wipGet(
        `/api/template-store/templates?namespace=${NAMESPACE}&page_size=1`,
      )) as { total: number }
      if (templates.total > 0) return 'ready'
    } catch {
      // Namespace exists but can't query templates — treat as needs bootstrap
    }
  }

  return 'needs_bootstrap'
}

/** Run the full bootstrap. Calls onProgress for each step. */
export async function runBootstrap(
  onProgress: (p: BootstrapProgress) => void,
): Promise<void> {
  const progress = (step: string, detail: string) =>
    onProgress({ step, detail, done: false })

  // Captured for the BOOTSTRAP_RECORD audit doc written in Step 6.
  const startedAt = new Date().toISOString()
  const terminologiesCreated: string[] = []
  const templatesCreated: string[] = []

  try {
    // Step 1: Create namespace (idempotent upsert)
    progress('namespace', 'Creating clintrial namespace...')
    await wipPut(`/api/registry/namespaces/${NAMESPACE}`, {
      description: 'Clinical Trials Explorer',
    })

    // Step 2: Load and create terminologies
    progress('terminologies', 'Loading seed data...')
    const termFiles = readdirSync(join(SEED_DIR, 'terminologies'))
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .sort()

    const terminologies: AnyObj[] = []
    for (const file of termFiles) {
      const data = JSON.parse(readFileSync(join(SEED_DIR, 'terminologies', file), 'utf-8'))
      terminologies.push(data)
      terminologiesCreated.push(data.value)
    }

    progress('terminologies', `Creating ${terminologies.length} terminologies...`)
    // Forward the seed's behavioural flags — the earlier builder silently
    // dropped `extensible`, so seeds declaring it bootstrapped as false
    // (CASE-733; CT_AE_TERM was the victim)
    const termBulk = terminologies.map((t) => ({
      value: t.value,
      label: t.label,
      description: t.description || '',
      namespace: NAMESPACE,
      ...(t.mutable ? { mutable: true } : {}),
      ...(t.extensible ? { extensible: true } : {}),
    }))
    const termResult = (await wipPost('/api/def-store/terminologies', termBulk)) as {
      results: Array<{ status: string; id: string; error?: string }>
    }

    // Build value → terminology_id map
    const termIdMap = new Map<string, string>()
    for (let i = 0; i < termResult.results.length; i++) {
      const r = termResult.results[i]
      if (r.id) termIdMap.set(terminologies[i].value, r.id)
    }

    // Step 3: Create terms for each terminology
    let totalTerms = 0
    for (const termData of terminologies) {
      const terms = termData.terms || []
      if (!terms.length) continue

      const termId = termIdMap.get(termData.value)
      if (!termId) continue

      progress('terms', `Creating ${terms.length} terms for ${termData.value}...`)
      await wipPost(`/api/def-store/terminologies/${termId}/terms`, terms)
      totalTerms += terms.length
    }
    progress('terms', `Created ${totalTerms} terms across ${terminologies.length} terminologies`)

    // Step 4: Create term relations (ontology edges)
    // Seed-file format key remains `ontology.relationships` for back-compat with existing
    // seed JSON; the WIP API was renamed to `term-relations` in def-store Phase 0 (CASE-65).
    // Seed refs use the 2-part TERMINOLOGY:VALUE shorthand, which def-store rejects
    // as ambiguous since CASE-778 (a value containing ':' is indistinguishable from
    // it). Qualify to the accepted ns:terminology:value form; UUIDs and already
    // 3-part refs pass through untouched.
    const qualifyTermRef = (ref: string): string =>
      ref.split(':').length === 2 ? `${NAMESPACE}:${ref}` : ref
    const allRelations: AnyObj[] = []
    for (const termData of terminologies) {
      const rels = termData.ontology?.relationships || []
      for (const rel of rels) {
        allRelations.push({
          source_term_id: qualifyTermRef(rel.source),
          target_term_id: qualifyTermRef(rel.target),
          relation_type: rel.type,
        })
      }
    }

    if (allRelations.length) {
      progress('relationships', `Creating ${allRelations.length} term relations...`)
      await wipPost(
        `/api/def-store/ontology/term-relations?namespace=${NAMESPACE}`,
        allRelations,
      )
    }

    // Step 5: Create templates (sorted by filename prefix for dependency order)
    const templateFiles = readdirSync(join(SEED_DIR, 'templates'))
      .filter((f) => f.endsWith('.json'))
      .sort()

    progress('templates', `Creating ${templateFiles.length} templates...`)
    // Captured from the create response so the BOOTSTRAP_RECORD write below can
    // pin template_id + version directly — explicit-version resolution bypasses
    // the 5s "latest" cache entirely, so no sleep is needed (CASE-727, PoNIF #6)
    let bootstrapTmpl: { template_id: string; version: number } | undefined
    for (const file of templateFiles) {
      const data = JSON.parse(readFileSync(join(SEED_DIR, 'templates', file), 'utf-8'))
      progress('templates', `Creating ${data.value}...`)

      const template: AnyObj = {
        value: data.value,
        label: data.label,
        description: data.description || '',
        namespace: NAMESPACE,
        identity_fields: data.identity_fields || [],
        fields: data.fields.map((f: AnyObj) => mapField(f)),
      }

      if (data.reporting) template.reporting = data.reporting

      const resp = (await wipPost('/api/template-store/templates?on_conflict=validate', [
        template,
      ])) as { results?: Array<{ id?: string; version?: number }> }
      if (data.value === BOOTSTRAP_RECORD_VALUE) {
        const item = resp.results?.[0]
        if (item?.id) bootstrapTmpl = { template_id: item.id, version: item.version ?? 1 }
      }
      // Track domain templates for the audit doc; the audit template itself
      // is infrastructure, not a domain template, so don't list it.
      if (data.value !== BOOTSTRAP_RECORD_VALUE) templatesCreated.push(data.value)
    }

    // Step 6: Write the BOOTSTRAP_RECORD audit doc (provenance trail —
    // CLAUDE.md "Namespace Bootstrap on Launch", rule 3). The create response
    // above already carries template_id + version, so this write cannot race
    // the template cache — the former 6s sleep is gone (CASE-727).
    progress('audit', 'Writing BOOTSTRAP_RECORD audit doc...')
    await writeBootstrapRecord({ startedAt, templatesCreated, terminologiesCreated }, bootstrapTmpl)

    onProgress({ step: 'done', detail: 'Bootstrap complete', done: true })
  } catch (err) {
    onProgress({
      step: 'error',
      detail: (err as Error).message,
      done: true,
      error: (err as Error).message,
    })
    throw err
  }
}

/**
 * Write the BOOTSTRAP_RECORD audit doc — one provenance record per
 * user-initiated bootstrap. Resolves the template_id + version first (the
 * document-store endpoint requires template_id, not template_value) and
 * pins template_version so the doc validates against the version we just
 * created rather than whatever the 5s "latest" cache resolves (PoNIF #6).
 * No edge types in this app, so edge_types_created is always empty.
 */
async function writeBootstrapRecord(
  meta: {
    startedAt: string
    templatesCreated: string[]
    terminologiesCreated: string[]
  },
  // Preferred: the ref captured from the create response (immune to the 5s
  // "latest" cache). The by-value GET remains only as a defensive fallback.
  tmplRef?: { template_id: string; version: number },
): Promise<void> {
  const tmpl =
    tmplRef ??
    ((await wipGet(
      `/api/template-store/templates/by-value/${BOOTSTRAP_RECORD_VALUE}?namespace=${NAMESPACE}`,
    )) as { template_id: string; version: number })

  const doc = {
    template_id: tmpl.template_id,
    template_version: tmpl.version,
    namespace: NAMESPACE,
    data: {
      bootstrap_id: `bootstrap-${meta.startedAt.replace(/[:.]/g, '-')}`,
      app_version: appVersion(),
      bootstrapped_at: meta.startedAt,
      commit_sha: process.env.VITE_BUILD_SHA || process.env.GIT_COMMIT_SHA || 'unknown',
      templates_created: meta.templatesCreated,
      edge_types_created: [],
      terminologies_created: meta.terminologiesCreated,
    },
  }

  const result = (await wipPost('/api/document-store/documents', [doc])) as {
    results?: Array<{ status: string; error?: string }>
  }
  const item = result.results?.[0]
  if (item && item.status === 'error') {
    throw new Error(`BOOTSTRAP_RECORD write failed: ${item.error || 'unknown error'}`)
  }
}

/** App version from package.json (falls back to env, then 'unknown'). */
function appVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'))
    return pkg.version || process.env.APP_VERSION || 'unknown'
  } catch {
    return process.env.APP_VERSION || 'unknown'
  }
}

/** Map a seed field definition to WIP template field format */
function mapField(f: AnyObj): AnyObj {
  const field: AnyObj = {
    name: f.name,
    label: f.label,
    type: f.type,
  }

  if (f.mandatory) field.mandatory = true
  if (f.terminology_ref) field.terminology_ref = f.terminology_ref
  if (f.semantic_type) field.semantic_type = f.semantic_type

  // Reference fields
  if (f.reference_type) field.reference_type = f.reference_type
  if (f.target_templates) field.target_templates = f.target_templates

  // Array fields
  if (f.type === 'array') {
    if (f.items?.type) field.array_item_type = f.items.type
    else if (f.array_item_type) field.array_item_type = f.array_item_type

    if (f.items?.terminology_ref) field.array_terminology_ref = f.items.terminology_ref
    else if (f.array_terminology_ref) field.array_terminology_ref = f.array_terminology_ref
  }

  // File fields
  if (f.type === 'file' && f.file_config) {
    field.file_config = {
      multiple: f.file_config.multiple ?? false,
      ...(f.file_config.max_count ? { max_files: f.file_config.max_count } : {}),
      ...(f.file_config.max_files ? { max_files: f.file_config.max_files } : {}),
      ...(f.file_config.max_size_mb ? { max_size_mb: f.file_config.max_size_mb } : {}),
      ...(f.file_config.accept ? { allowed_types: [f.file_config.accept] } : {}),
      ...(f.file_config.allowed_types ? { allowed_types: f.file_config.allowed_types } : {}),
    }
  }

  // Validation
  if (f.validation) field.validation = f.validation
  if (f.enum) field.validation = { ...field.validation, enum: f.enum }

  return field
}
