import { reportQuery, resolveTemplateId, createDocumentsBulk } from './wip-api.js'

export interface AppSettings {
  sync_enabled: boolean
  sync_interval_hours: number
}

const SETTINGS_KEY = 'clintrial-defaults'

const DEFAULTS: AppSettings = {
  sync_enabled: false,
  sync_interval_hours: 4,
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const result = await reportQuery<{
      sync_enabled: boolean | null
      sync_interval_hours: number | null
    }>(
      `SELECT sync_enabled, sync_interval_hours
       FROM doc_ct_settings WHERE settings_key = $1 AND status = 'active'`,
      [SETTINGS_KEY],
    )

    if (result.rows.length > 0) {
      const row = result.rows[0]
      return {
        sync_enabled: row.sync_enabled ?? DEFAULTS.sync_enabled,
        sync_interval_hours: row.sync_interval_hours ?? DEFAULTS.sync_interval_hours,
      }
    }
  } catch (err) {
    console.warn('Could not load settings from reporting:', err)
  }

  // No doc found — create one with defaults so future reads find it
  try {
    await saveSettings(DEFAULTS)
  } catch (err) {
    console.warn('Could not seed default settings:', err)
  }
  return { ...DEFAULTS }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const templateId = await resolveTemplateId('CT_SETTINGS')
  await createDocumentsBulk(templateId, [
    {
      settings_key: SETTINGS_KEY,
      sync_enabled: settings.sync_enabled,
      sync_interval_hours: settings.sync_interval_hours,
    },
  ])
}
