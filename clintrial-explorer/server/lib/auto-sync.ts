import { loadSettings } from './settings.js'
import { runImport, getActiveJob } from './import-orchestrator.js'

const DEFAULT_SPONSORS = ['Hoffmann-La Roche', 'Genentech, Inc.']

let timer: ReturnType<typeof setTimeout> | null = null

export async function startAutoSync(): Promise<void> {
  stopAutoSync()

  let settings
  try {
    settings = await loadSettings()
  } catch {
    console.log('[auto-sync] Could not load settings, skipping')
    return
  }

  if (!settings.sync_enabled) {
    console.log('[auto-sync] Disabled')
    return
  }

  scheduleNext(settings.sync_interval_hours)
}

export function stopAutoSync(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function scheduleNext(hours: number): void {
  const ms = hours * 60 * 60 * 1000
  console.log(`[auto-sync] Next run in ${hours}h`)
  timer = setTimeout(() => runCycle(), ms)
}

async function runCycle(): Promise<void> {
  timer = null

  const activeJob = getActiveJob()
  if (activeJob?.status === 'running') {
    console.log('[auto-sync] Import already running, skipping')
  } else {
    console.log('[auto-sync] Starting incremental import')
    try {
      const counts = await runImport(
        { mode: 'incremental', sponsors: DEFAULT_SPONSORS, skipPdfs: false },
        (p) => {
          if (p.phase === 'complete' || p.phase === 'error') {
            console.log(`[auto-sync] ${p.phase}: ${p.step}`)
          }
        },
      )
      console.log('[auto-sync] Complete', counts)
    } catch (err) {
      console.error('[auto-sync] Error:', err)
    }
  }

  const settings = await loadSettings().catch(() => null)
  if (settings?.sync_enabled) {
    scheduleNext(settings.sync_interval_hours)
  } else {
    console.log('[auto-sync] Disabled after run, not rescheduling')
  }
}
