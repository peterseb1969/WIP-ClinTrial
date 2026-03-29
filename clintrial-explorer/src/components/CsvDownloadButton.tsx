import { Download } from 'lucide-react'
import { buildCsvString, downloadCsv } from '@/lib/csv-export'

interface CsvDownloadButtonProps {
  getData: () => { columns: string[]; rows: string[][] }
  filenamePrefix: string
  label?: string
  className?: string
}

export function CsvDownloadButton({
  getData,
  filenamePrefix,
  label = 'Export CSV',
  className,
}: CsvDownloadButtonProps) {
  const handleClick = () => {
    const { columns, rows } = getData()
    const csv = buildCsvString(columns, rows)
    downloadCsv(csv, filenamePrefix)
  }

  return (
    <button
      onClick={handleClick}
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-text-muted hover:bg-gray-50'
      }
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}
