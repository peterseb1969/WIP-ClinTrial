import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Format a number with locale separators */
export function formatNumber(n: number): string {
  return n.toLocaleString()
}

/** Build a trial list URL with filters as query params */
export function trialsUrl(filters: Record<string, string>): string {
  const params = new URLSearchParams(filters)
  return `/trials?${params.toString()}`
}
