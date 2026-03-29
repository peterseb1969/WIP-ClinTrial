import { useMemo, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Download, Upload } from 'lucide-react'
import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import { CsvDownloadButton } from '@/components/CsvDownloadButton'
import { StatusBadge } from '@/components/StatusBadge'
import { BookmarkButton } from '@/components/BookmarkButton'
import { PageLoading } from '@/components/LoadingSpinner'
import { useAllTrials } from '@/hooks/useAllTrials'
import { useBookmarks } from '@/hooks/useBookmarks'
import { formatPhase } from '@/lib/trial-utils'

export function BookmarksPage() {
  const { data: trials, isLoading } = useAllTrials()
  const { bookmarkedIds, exportJson, importJson } = useBookmarks()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const bookmarkedTrials = useMemo(() => {
    if (!trials) return []
    return trials.filter((t) => bookmarkedIds.has(t.data.nct_id))
  }, [trials, bookmarkedIds])

  const handleExport = () => {
    const json = exportJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clintrial-bookmarks-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const { added, total } = importJson(text)
      alert(`Imported ${added} new bookmarks. Total: ${total}.`)
    } catch {
      alert('Invalid bookmark file.')
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (isLoading) return <PageLoading message="Loading bookmarks..." />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Bookmarks</h1>
        <span className="text-sm text-text-muted">{bookmarkedIds.size} bookmarked</span>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <CsvDownloadButton
          getData={() => ({
            columns: ['NCT ID', 'Title', 'Status', 'Phase'],
            rows: bookmarkedTrials.map((t) => [
              t.data.nct_id,
              t.data.brief_title || t.data.title,
              t.data.status,
              (t.data.phases || []).join(';'),
            ]),
          })}
          filenamePrefix="bookmarked-trials"
        />
        <button
          onClick={handleExport}
          disabled={bookmarkedIds.size === 0}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-text-muted hover:bg-gray-50 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" />
          Export JSON
        </button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-text-muted hover:bg-gray-50">
          <Upload className="h-3.5 w-3.5" />
          Import
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
        </label>
      </div>

      {bookmarkedTrials.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-text-muted">
            No bookmarks yet. Click the bookmark icon on any trial to save it here.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {bookmarkedTrials.map((trial) => (
            <Card
              key={trial.document_id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/trials/${trial.data.nct_id}`)}
            >
              <div className="flex items-start gap-3">
                <BookmarkButton nctId={trial.data.nct_id} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/trials/${trial.data.nct_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono text-sm font-medium text-primary hover:underline"
                    >
                      {trial.data.nct_id}
                    </Link>
                    <StatusBadge status={trial.data.status} />
                    {(trial.data.phases || []).map((p) => (
                      <Badge key={p} variant="muted">{formatPhase(p)}</Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-sm text-text-muted truncate">
                    {trial.data.brief_title || trial.data.title}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
