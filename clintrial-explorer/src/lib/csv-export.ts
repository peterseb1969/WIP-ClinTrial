/** Build a CSV string from column headers and row arrays, handling quoting/escaping */
export function buildCsvString(columns: string[], rows: string[][]): string {
  const escape = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }
  const lines = [
    columns.map(escape).join(','),
    ...rows.map((row) => row.map((v) => escape(v ?? '')).join(',')),
  ]
  return lines.join('\n')
}

/** Trigger a browser download of a CSV string with a date-stamped filename */
export function downloadCsv(csvString: string, filenamePrefix: string) {
  const date = new Date().toISOString().slice(0, 10)
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filenamePrefix}-${date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
