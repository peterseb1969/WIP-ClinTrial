import { config } from './config'

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
  const res = await fetch('/api/reporting-sync/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.wipApiKey,
    },
    body: JSON.stringify({ sql, params: params ?? null, max_rows: maxRows }),
  })

  if (!res.ok) {
    throw new Error(`Reporting query failed: ${res.status} ${res.statusText}`)
  }

  return res.json()
}
