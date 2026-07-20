/**
 * Server-side WIP API client.
 * Makes direct HTTP calls to WIP backend with API key injection.
 */

import { PIPELINE_MAX_ROWS, type ReportQueryResult } from '../../shared/reporting-types.js'

const WIP_BASE_URL = process.env.WIP_BASE_URL || 'https://localhost:8443'
const WIP_API_KEY = process.env.WIP_API_KEY || 'dev_master_key_for_testing'
const NAMESPACE = 'clintrial'

// Disable TLS verification outside production only (dev WIP uses a self-signed cert).
// Production trust comes from NODE_EXTRA_CA_CERTS — auto-injected on apps-only
// installs; provide via `wip-deploy export-ca` otherwise (CASE-724).
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

function headers(contentType = 'application/json'): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-API-Key': WIP_API_KEY,
  }
}

export async function wipGet(path: string): Promise<unknown> {
  const res = await fetch(`${WIP_BASE_URL}${path}`, { headers: headers() })
  if (!res.ok) throw new Error(`WIP GET ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function wipPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${WIP_BASE_URL}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`WIP POST ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function wipPatch(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${WIP_BASE_URL}${path}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`WIP PATCH ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

export async function wipDelete(path: string): Promise<unknown> {
  const res = await fetch(`${WIP_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: headers(),
  })
  if (!res.ok) throw new Error(`WIP DELETE ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

/** Upload a file to WIP via multipart form */
export async function wipUploadFile(
  fileBuffer: Buffer,
  filename: string,
  opts: { description?: string; tags?: string; category?: string; allowedTemplates?: string },
): Promise<{ file_id: string }> {
  const formData = new FormData()
  formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), filename)
  formData.append('namespace', NAMESPACE)
  if (opts.description) formData.append('description', opts.description)
  if (opts.tags) formData.append('tags', opts.tags)
  if (opts.category) formData.append('category', opts.category)
  if (opts.allowedTemplates) formData.append('allowed_templates', opts.allowedTemplates)

  const res = await fetch(`${WIP_BASE_URL}/api/document-store/files`, {
    method: 'POST',
    headers: { 'X-API-Key': WIP_API_KEY },
    body: formData,
  })
  if (!res.ok) throw new Error(`WIP file upload failed: ${res.status}`)
  const result = await res.json()
  const item = Array.isArray(result) ? result[0] : result
  return { file_id: item.file_id || item.id }
}

export type { ReportQueryResult } from '../../shared/reporting-types.js'

/** Execute SQL against WIP reporting database */
export async function reportQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  maxRows = PIPELINE_MAX_ROWS,
): Promise<ReportQueryResult<T>> {
  // Reporting tables live in per-namespace PG schemas (CASE-628/CASE-632);
  // namespace points search_path at our schema so unqualified names resolve.
  const body: Record<string, unknown> = { sql, namespace: NAMESPACE, max_rows: maxRows }
  if (params.length > 0) body.params = params
  const result = (await wipPost('/api/reporting-sync/query', body)) as ReportQueryResult<T>
  if (result.truncated) {
    // Silent caps read as complete data — make truncation loud (CASE-728)
    console.warn(`[reportQuery] result truncated at ${maxRows} rows: ${sql.slice(0, 120)}`)
  }
  return result
}

/** Template ID + version cache */
const templateCache = new Map<string, { id: string; version: number }>()

/** Clear the template cache (call when starting a new import to avoid stale IDs) */
export function clearTemplateCache(): void {
  templateCache.clear()
}

/** Resolve template value to template_id and latest version. */
export async function resolveTemplateId(value: string): Promise<string> {
  const cached = templateCache.get(value)
  if (cached) return cached.id

  const data = (await wipGet(
    `/api/template-store/templates/by-value/${value}?namespace=${NAMESPACE}`,
  )) as { template_id: string; version: number }
  templateCache.set(value, { id: data.template_id, version: data.version })
  return data.template_id
}

/** Get the cached version for a template ID */
export function getTemplateVersion(templateId: string): number | undefined {
  for (const entry of templateCache.values()) {
    if (entry.id === templateId) return entry.version
  }
  return undefined
}

/** Resolve multiple template values at once */
export async function resolveTemplateIds(
  values: string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  await Promise.all(
    values.map(async (v) => {
      result[v] = await resolveTemplateId(v)
    }),
  )
  return result
}

export interface BulkResult {
  index: number
  status: string
  id?: string
  document_id?: string
  version?: number
  error?: string
  message?: string
}

/** Create documents in bulk with batching. Returns per-item results. */
export async function createDocumentsBulk(
  templateId: string,
  dataList: Record<string, unknown>[],
  batchSize = 100,
): Promise<{ created: number; updated: number; errors: number; results: BulkResult[] }> {
  let created = 0
  let updated = 0
  let errors = 0
  const allResults: BulkResult[] = []

  for (let i = 0; i < dataList.length; i += batchSize) {
    const batch = dataList.slice(i, i + batchSize)
    const version = getTemplateVersion(templateId)
    const docs = batch.map((data) => ({
      template_id: templateId,
      ...(version ? { template_version: version } : {}),
      namespace: NAMESPACE,
      data,
      created_by: 'clintrial-import',
    }))

    try {
      const resp = (await wipPost('/api/document-store/documents', docs)) as
        | { results: BulkResult[] }
        | BulkResult[]
      const items = Array.isArray(resp) ? resp : resp.results || []

      for (const item of items) {
        const status = item.status || ''
        if (status === 'error') {
          errors++
        } else if ((item.version || 1) > 1) {
          updated++
        } else {
          created++
        }
        // WIP returns batch-relative indices; rebase to the caller's input
        // order so results[i].index attributes across batches (CASE-725)
        allResults.push({ ...item, index: i + (item.index ?? 0) })
      }
    } catch (err) {
      errors += batch.length
      console.error(`Bulk create batch error:`, err)
      // Keep results[] complete: a failed batch still yields one error item
      // per input so callers can attribute every submitted document
      allResults.push(...batch.map((_, j) => ({
        index: i + j,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })))
    }
  }

  return { created, updated, errors, results: allResults }
}

/** Resolve a terminology value to its terminology_id */
export async function resolveTerminologyId(value: string, namespace?: string): Promise<string> {
  const ns = namespace || NAMESPACE
  const data = (await wipGet(
    `/api/def-store/terminologies/by-value/${value}?namespace=${ns}`,
  )) as { terminology_id: string }
  return data.terminology_id
}

/** Create terms in a terminology. Returns per-item results. */
export async function createTerms(
  terminologyId: string,
  terms: Array<{ value: string; label: string; aliases?: string[] }>,
): Promise<unknown> {
  return wipPost(`/api/def-store/terminologies/${terminologyId}/terms`, terms)
}

/** Generic PUT with bulk envelope (matching wip-client convention). */
export async function wipPut(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${WIP_BASE_URL}${path}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`WIP PUT ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

/** Generic DELETE with body (matching wip-client convention). */
export async function wipDeleteWithBody(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${WIP_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: headers(),
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`WIP DELETE ${path}: ${res.status} ${res.statusText}`)
  return res.json()
}

/** Update a term's aliases (and optionally other fields). */
export async function updateTermAliases(termId: string, aliases: string[]): Promise<unknown> {
  return wipPut('/api/def-store/terms', [{ term_id: termId, aliases }])
}

/** Deactivate (soft-delete) a term by ID. */
export async function deleteTermById(termId: string): Promise<unknown> {
  return wipDeleteWithBody('/api/def-store/terms', [{ id: termId }])
}

export { NAMESPACE }
