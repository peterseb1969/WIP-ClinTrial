import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Settings, RefreshCw, Clock, ChevronRight, Check, Loader2, AlertCircle } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import { useSyncState } from '@/hooks/useImport'
import { PageLoading } from '@/components/LoadingSpinner'

const INTERVAL_OPTIONS = [
  { value: 1, label: 'Every hour' },
  { value: 2, label: 'Every 2 hours' },
  { value: 4, label: 'Every 4 hours' },
  { value: 8, label: 'Every 8 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Every 24 hours' },
]

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings()
  const { data: syncState } = useSyncState()
  const updateSettings = useUpdateSettings()

  const [syncEnabled, setSyncEnabled] = useState(false)
  const [intervalHours, setIntervalHours] = useState(4)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (settings) {
      setSyncEnabled(settings.sync_enabled)
      setIntervalHours(settings.sync_interval_hours)
      setDirty(false)
    }
  }, [settings])

  function handleToggle() {
    setSyncEnabled((v) => !v)
    setDirty(true)
  }

  function handleIntervalChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setIntervalHours(Number(e.target.value))
    setDirty(true)
  }

  function handleSave() {
    updateSettings.mutate({
      sync_enabled: syncEnabled,
      sync_interval_hours: intervalHours,
    })
    setDirty(false)
  }

  if (isLoading) return <PageLoading />

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-primary" />
        <h1 className="text-2xl font-semibold text-text">Settings</h1>
      </div>

      {/* Auto-Sync Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Auto-Sync
          </CardTitle>
        </CardHeader>
        <div className="space-y-4 p-4 pt-0">
          <p className="text-sm text-text-muted">
            Automatically import new trials from ClinicalTrials.gov on a schedule.
          </p>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
            <div>
              <div className="text-sm font-medium text-text">Enable auto-sync</div>
              <div className="text-xs text-text-muted">
                Runs an incremental import at the configured interval
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={syncEnabled}
              onClick={handleToggle}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                syncEnabled ? 'bg-primary' : 'bg-gray-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  syncEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
            <div>
              <div className="text-sm font-medium text-text">Sync interval</div>
              <div className="text-xs text-text-muted">
                How often to check for new trials
              </div>
            </div>
            <select
              value={intervalHours}
              onChange={handleIntervalChange}
              disabled={!syncEnabled}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-text disabled:opacity-50"
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {syncState && (
            <div className="flex items-center gap-2 rounded-lg bg-surface p-3 text-sm">
              <Clock className="h-4 w-4 text-text-muted" />
              <span className="text-text-muted">Last sync:</span>
              <span className="text-text">
                {syncState.last_sync
                  ? new Date(syncState.last_sync).toLocaleString()
                  : 'Never'}
              </span>
              {syncState.trial_count > 0 && (
                <Badge variant="muted" className="ml-auto">
                  {syncState.trial_count} trials tracked
                </Badge>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={!dirty || updateSettings.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {updateSettings.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save
            </button>
            {updateSettings.isSuccess && !dirty && (
              <span className="text-sm text-green-600">Saved</span>
            )}
            {updateSettings.isError && (
              <span className="flex items-center gap-1 text-sm text-red-600">
                <AlertCircle className="h-3.5 w-3.5" />
                {updateSettings.error.message}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Link to Classification Rules */}
      <Link
        to="/settings/rules"
        className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 text-sm font-medium text-text hover:bg-gray-50 transition-colors"
      >
        <div>
          <div className="font-medium">Classification Rules</div>
          <div className="text-xs text-text-muted">
            Manage TA classification rules for trial auto-tagging
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-text-muted" />
      </Link>
    </div>
  )
}
