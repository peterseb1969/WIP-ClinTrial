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
    }

    progress('terminologies', `Creating ${terminologies.length} terminologies...`)
    const termBulk = terminologies.map((t) => ({
      value: t.value,
      label: t.label,
      description: t.description || '',
      namespace: NAMESPACE,
      ...(t.mutable ? { mutable: true } : {}),
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

    // Step 4: Create ontology relationships
    const allRelationships: AnyObj[] = []
    for (const termData of terminologies) {
      const rels = termData.ontology?.relationships || []
      for (const rel of rels) {
        allRelationships.push({
          source_term_id: rel.source,
          target_term_id: rel.target,
          relationship_type: rel.type,
        })
      }
    }

    if (allRelationships.length) {
      progress('relationships', `Creating ${allRelationships.length} ontology relationships...`)
      await wipPost(
        `/api/def-store/ontology/relationships?namespace=${NAMESPACE}`,
        allRelationships,
      )
    }

    // Step 5: Create templates (sorted by filename prefix for dependency order)
    const templateFiles = readdirSync(join(SEED_DIR, 'templates'))
      .filter((f) => f.endsWith('.json'))
      .sort()

    progress('templates', `Creating ${templateFiles.length} templates...`)
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

      await wipPost('/api/template-store/templates?on_conflict=validate', [template])
    }

    // Wait for template cache to refresh (PoNIF #6)
    progress('done', 'Waiting for caches to refresh...')
    await new Promise((resolve) => setTimeout(resolve, 6000))

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
