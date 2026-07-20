import { getConfig } from './config'
import { UI_MAX_ROWS, type ReportQueryResult } from '../../shared/reporting-types'

// Reporting tables live in per-namespace PG schemas (CASE-628/CASE-632);
// passing namespace points search_path at our schema so unqualified
// doc_* / terms / terminologies names keep resolving.
const NAMESPACE = 'clintrial'

export type { ReportQueryResult }

/** Execute a SQL query against the WIP reporting database */
export async function reportQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
  maxRows = UI_MAX_ROWS,
): Promise<ReportQueryResult<T>> {
  const { wipApiUrl } = getConfig()
  const res = await fetch(`${wipApiUrl}/api/reporting-sync/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // API key injected server-side by @wip/proxy
    },
    body: JSON.stringify({
      sql,
      namespace: NAMESPACE,
      ...(params && params.length > 0 ? { params } : {}),
      max_rows: maxRows,
    }),
  })

  if (!res.ok) {
    throw new Error(`Reporting query failed: ${res.status} ${res.statusText}`)
  }

  const result = (await res.json()) as ReportQueryResult<T>
  if (result.truncated) {
    // Silent caps read as complete data — make truncation loud (CASE-728)
    console.warn(`[reportQuery] result truncated at ${maxRows} rows: ${sql.slice(0, 120)}`)
  }
  return result
}
