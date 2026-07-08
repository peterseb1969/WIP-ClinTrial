import { getConfig } from './config'

// Reporting tables live in per-namespace PG schemas (CASE-628/CASE-632);
// passing namespace points search_path at our schema so unqualified
// doc_* / terms / terminologies names keep resolving.
const NAMESPACE = 'clintrial'

interface QueryResult<T = Record<string, unknown>> {
  columns: string[]
  rows: T[]
  row_count: number
  truncated: boolean
}

/** Execute a SQL query against the WIP reporting database */
export async function reportQuery<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
  maxRows = 1000,
): Promise<QueryResult<T>> {
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

  return res.json()
}
