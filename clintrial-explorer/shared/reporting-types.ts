/**
 * Shared contract for POST /api/reporting-sync/query — imported by both the
 * client wrapper (src/lib/reporting.ts, via the proxy) and the server wrapper
 * (server/lib/wip-api.ts, direct). One type, so the shapes cannot drift; the
 * row caps stay deliberately different per environment (CASE-728).
 */
export interface ReportQueryResult<T = Record<string, unknown>> {
  columns: string[]
  rows: T[]
  row_count: number
  truncated: boolean
}

/** UI-bound queries travel browser → proxy → WIP; keep payloads small. */
export const UI_MAX_ROWS = 1000

/** Pipeline scans (import/classify) legitimately sweep all ~2,600 trials. */
export const PIPELINE_MAX_ROWS = 10000
