/**
 * Poll a TanStack Query refetch until the written state is visible, or
 * attempts run out. Replaces the blind `setTimeout(refetch, 3000)` timers
 * for reporting-sync lag (CASE-727): the first attempt fires immediately,
 * so the common case resolves faster than any fixed delay, and a slow sync
 * gets bounded retries instead of a permanently stale UI.
 *
 * Returns true when the predicate matched, false when attempts ran out
 * (callers may fall back to a plain invalidate — the data will catch up
 * on the next natural refetch).
 */
export async function refetchUntil<T>(
  refetch: () => Promise<{ data?: T | undefined }>,
  predicate: (data: T | undefined) => boolean,
  { intervalMs = 1000, maxAttempts = 8 }: { intervalMs?: number; maxAttempts?: number } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data } = await refetch()
    if (predicate(data)) return true
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  return false
}

/** Order-insensitive string-array equality — for therapeutic-area predicates */
export function sameSet(a: string[] | undefined, b: string[] | undefined): boolean {
  const sa = [...(a ?? [])].sort()
  const sb = [...(b ?? [])].sort()
  return sa.length === sb.length && sa.every((v, i) => v === sb[i])
}
