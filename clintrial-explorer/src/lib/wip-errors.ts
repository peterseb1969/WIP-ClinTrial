import {
  WipAuthError,
  WipBulkItemError,
  WipNetworkError,
  WipNotFoundError,
  WipValidationError,
  WipError,
} from '@wip/client'

/**
 * Human-readable message from a @wip/client error (CASE-726) — replaces
 * `String(e)`, which rendered as "Error: [object Object]"-grade noise and
 * hid the difference between "your input is invalid" and "the network blinked".
 */
export function describeWipError(e: unknown): string {
  if (e instanceof WipBulkItemError) {
    return `Item ${e.index} ${e.itemStatus ?? 'failed'}: ${e.message}`
  }
  if (e instanceof WipValidationError) {
    return `Validation failed: ${e.message}`
  }
  if (e instanceof WipNotFoundError) {
    return `Not found: ${e.message}`
  }
  if (e instanceof WipAuthError) {
    return `Not authorized (${e.statusCode}) — your session may have expired`
  }
  if (e instanceof WipNetworkError) {
    return 'Network error reaching WIP — check the connection and retry'
  }
  if (e instanceof WipError) {
    return e.message
  }
  return e instanceof Error ? e.message : String(e)
}
