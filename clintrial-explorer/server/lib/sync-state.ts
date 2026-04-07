/**
 * Sync state management via WIP documents.
 * Replaces the file-based sync-state.json with a WIP CT_SYNC_STATE document.
 */

import { reportQuery, resolveTemplateId, createDocumentsBulk } from './wip-api.js'

export interface TrialSyncEntry {
  last_update: string
  synced_at: string
  source: string
}

export interface SyncState {
  trials: Record<string, TrialSyncEntry>
  last_sync: string | null
  last_import_summary: Record<string, unknown> | null
}

const SYNC_KEY = 'clintrial-import'

/** Load sync state from WIP via reporting SQL */
export async function loadSyncState(): Promise<SyncState> {
  try {
    const result = await reportQuery<{
      sync_key: string
      trials_state: string | null
      last_sync: string | null
      last_import_summary: string | null
    }>(
      `SELECT sync_key, trials_state, last_sync, last_import_summary
       FROM doc_ct_sync_state WHERE sync_key = $1 AND status = 'active'`,
      [SYNC_KEY],
    )

    if (result.rows.length > 0) {
      const row = result.rows[0]
      return {
        trials: row.trials_state ? JSON.parse(row.trials_state) : {},
        last_sync: row.last_sync,
        last_import_summary: row.last_import_summary
          ? JSON.parse(row.last_import_summary)
          : null,
      }
    }
  } catch (err) {
    console.warn('Could not load sync state from reporting:', err)
  }

  return { trials: {}, last_sync: null, last_import_summary: null }
}

/** Save sync state to WIP */
export async function saveSyncState(state: SyncState): Promise<void> {
  try {
    const templateId = await resolveTemplateId('CT_SYNC_STATE')
    state.last_sync = new Date().toISOString()

    await createDocumentsBulk(templateId, [
      {
        sync_key: SYNC_KEY,
        trials_state: JSON.stringify(state.trials),
        last_sync: state.last_sync,
        last_import_summary: state.last_import_summary
          ? JSON.stringify(state.last_import_summary)
          : null,
      },
    ])
  } catch (err) {
    console.error('Failed to save sync state:', err)
  }
}

/** Check if a trial should be skipped (already synced with same update date) */
export function shouldSkipTrial(
  nctId: string,
  lastUpdate: string,
  state: SyncState,
): boolean {
  const entry = state.trials[nctId]
  if (!entry) return false
  return entry.last_update === lastUpdate
}

/** Update sync state for a single trial */
export function updateTrialSyncEntry(
  state: SyncState,
  nctId: string,
  lastUpdate: string,
  source: string,
): void {
  state.trials[nctId] = {
    last_update: lastUpdate,
    synced_at: new Date().toISOString(),
    source,
  }
}
