/**
 * ClinicalTrials.gov API v2 client.
 * Ported from scripts/import_trials.py.
 */

const CTGOV_BASE = 'https://clinicaltrials.gov/api/v2'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface SearchOptions {
  maxResults?: number
  sinceDate?: string // YYYY-MM-DD
  signal?: AbortSignal
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

/** Search ClinicalTrials.gov for trials by sponsor. Paginates through all results. */
export async function searchTrialsBySponsor(
  sponsor: string,
  options: SearchOptions = {},
): Promise<AnyObj[]> {
  const { maxResults, sinceDate, signal } = options
  const pageSize = Math.min(maxResults || 1000, 1000)
  const params = new URLSearchParams({
    'query.spons': sponsor,
    pageSize: String(pageSize),
    fields: 'protocolSection,hasResults',
  })
  if (sinceDate) {
    params.set('filter.advanced', `AREA[LastUpdatePostDate]RANGE[${sinceDate},MAX]`)
  }

  const allStudies: AnyObj[] = []
  let pageToken: string | null = null

  while (true) {
    if (signal?.aborted) break

    const url = `${CTGOV_BASE}/studies?${params.toString()}${pageToken ? `&pageToken=${pageToken}` : ''}`
    const resp = await fetch(url, { signal })
    if (!resp.ok) {
      console.error(`CT.gov API error: ${resp.status} ${resp.statusText}`)
      break
    }

    const data = await resp.json()
    const studies = data.studies || []
    if (!studies.length) break

    allStudies.push(...studies)

    if (maxResults && allStudies.length >= maxResults) {
      return allStudies.slice(0, maxResults)
    }

    pageToken = data.nextPageToken
    if (!pageToken) break

    await sleep(300) // Rate limiting
  }

  return allStudies
}

/** Fetch full trial detail from ClinicalTrials.gov */
export async function fetchTrialDetail(
  nctId: string,
  signal?: AbortSignal,
): Promise<AnyObj | null> {
  try {
    const resp = await fetch(`${CTGOV_BASE}/studies/${nctId}`, { signal })
    if (!resp.ok) return null
    return resp.json()
  } catch (err) {
    console.error(`Error fetching detail for ${nctId}:`, err)
    return null
  }
}

/** Fetch results section and document section separately */
export async function fetchTrialResultsAndDocs(
  nctId: string,
  signal?: AbortSignal,
): Promise<AnyObj> {
  try {
    const resp = await fetch(
      `${CTGOV_BASE}/studies/${nctId}?fields=resultsSection,documentSection`,
      { signal },
    )
    if (!resp.ok) return {}
    return resp.json()
  } catch {
    return {}
  }
}

/** Fetch specific trials by NCT ID */
export async function fetchTrialsByNctIds(
  nctIds: string[],
  signal?: AbortSignal,
): Promise<AnyObj[]> {
  const results: AnyObj[] = []
  for (const nctId of nctIds) {
    if (signal?.aborted) break
    const study = await fetchTrialDetail(nctId, signal)
    if (study) results.push(study)
    await sleep(300)
  }
  return results
}
