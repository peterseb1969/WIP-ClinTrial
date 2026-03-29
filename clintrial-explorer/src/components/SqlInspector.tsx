import { useState } from 'react'
import { Database, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'

export interface SqlQuery {
  label: string
  sql: string
  params?: unknown[]
}

interface SqlInspectorProps {
  queries: SqlQuery[]
}

export function SqlInspector({ queries }: SqlInspectorProps) {
  const [open, setOpen] = useState(false)

  if (queries.length === 0) return null

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text"
      >
        <Database className="h-3 w-3" />
        <span>SQL</span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {queries.map((q, i) => (
            <QueryBlock key={i} query={q} />
          ))}
        </div>
      )}
    </div>
  )
}

function QueryBlock({ query }: { query: SqlQuery }) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(query.sql)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 text-xs">
      <div className="flex items-center justify-between border-b border-gray-200 px-3 py-1.5">
        <span className="font-medium text-text-muted">{query.label}</span>
        <button
          onClick={copyToClipboard}
          className="inline-flex items-center gap-1 text-text-muted hover:text-text"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-text">
        {query.sql.trim()}
      </pre>
      {query.params && query.params.length > 0 && (
        <div className="border-t border-gray-200 px-3 py-1.5 text-text-muted">
          <span className="font-medium">Params: </span>
          {query.params.map((p, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <code className="rounded bg-gray-200 px-1">
                ${i + 1}={Array.isArray(p) ? `[${(p as string[]).length} items]` : String(p)}
              </code>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
