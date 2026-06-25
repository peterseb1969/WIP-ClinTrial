import { Router } from 'express'
import { loadSettings, saveSettings } from '../lib/settings.js'
import { startAutoSync, stopAutoSync } from '../lib/auto-sync.js'

const router = Router()

router.get('/settings', async (_req, res) => {
  try {
    const settings = await loadSettings()
    res.json(settings)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.put('/settings', async (req, res) => {
  try {
    const body = req.body || {}
    const settings = {
      sync_enabled: Boolean(body.sync_enabled),
      sync_interval_hours: Number(body.sync_interval_hours) || 4,
    }

    await saveSettings(settings)

    if (settings.sync_enabled) {
      await startAutoSync()
    } else {
      stopAutoSync()
    }

    res.json(settings)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
