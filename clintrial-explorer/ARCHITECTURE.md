# Architecture

## Route Structure

| Route | Page | Data Source |
|-------|------|-------------|
| `/` | DashboardPage | 7 parallel SQL queries via reporting API |
| `/trials` | TrialsPage | `useFilteredTrials` (client-side filter of all trials) |
| `/trials/:nctId` | TrialDetailPage | SQL query per tab (trial, outcomes, sites, AEs, baselines) |
| `/molecules` | MoleculesPage | Derived from `useFilteredTrials` |
| `/sites` | SitesPage | SQL aggregate + client-side filter by trial set |
| `/bookmarks` | BookmarksPage | `useFilteredTrials` + localStorage bookmark set |
| `/sync` | SyncPage | WIP namespace stats + template doc counts |

All routes are nested under `<Layout>` which provides the sidebar, top bar with breadcrumbs, and the `<GlobalFilterBar>`.

## Component Hierarchy

```
App
├── QueryClientProvider
│   └── WipProvider
│       └── BrowserRouter (basename=/apps/clintrial)
│           └── Layout
│               ├── Sidebar (nav links, bookmark count badge)
│               ├── Top bar (breadcrumbs, home link)
│               ├── GlobalFilterBar (shows active filters on all pages)
│               └── <Outlet> (page content)
```

### Shared Components

- `ChipLink` — Clickable chip that adds a filter via `useFilterNav` and navigates to `/trials`
- `StatusBadge` — Color-coded trial status badge
- `BookmarkButton` — Star toggle for bookmarking trials
- `Card`, `Badge`, `LoadingSpinner`, `ErrorMessage` — Generic UI primitives

## Data Flow

### Two data paths

1. **WIP Document API** (`@wip/client` via `@wip/react` hooks) — Used for: trial file downloads (`useTrialFiles`), sync page namespace stats.

2. **WIP Reporting SQL API** (`/api/reporting-sync/query`) — Used for everything else. The reporting layer mirrors all WIP documents into PostgreSQL with flattened columns. This enables server-side aggregation (`GROUP BY`, `COUNT`, `jsonb_array_elements_text`) that the document API cannot do.

### Data flow for the Trials list

```
SQL: SELECT columns FROM doc_ct_trial → useAllTrials (parse rows into TrialDocument[])
    → useFilteredTrials (apply global filters client-side)
        → TrialsPage (paginate, render table)
        → MoleculesPage (derive molecule counts from filtered set)
        → SitesPage (filter site stats to matching trial NCT IDs)
```

### Data flow for Trial Detail

```
SQL: SELECT data_json FROM doc_ct_trial WHERE nct_id = $1 → useTrial
SQL: SELECT data_json FROM doc_ct_trial_outcome WHERE nct_id = $1 → useTrialOutcomes
SQL: SELECT data_json FROM doc_ct_trial_site WHERE nct_id = $1 → useTrialSites
SQL: SELECT data_json FROM doc_ct_trial_ae WHERE nct_id = $1 → useTrialAEs
SQL: SELECT data_json FROM doc_ct_trial_baseline WHERE nct_id = $1 → useTrialBaselines
```

Each tab fetches on-demand when activated.

### Data flow for Dashboard

```
7 parallel SQL queries (COUNT, GROUP BY with jsonb_array_elements_text)
    → useDashboardStats → DashboardPage (render charts)
```

No trial-level data is fetched for the dashboard — only aggregates.

## State Management

| State | Where | Mechanism |
|-------|-------|-----------|
| Trial data cache | TanStack Query | 5-min stale time, auto-refetch |
| Global filters | `useTrialFilters` store | `useSyncExternalStore` + `sessionStorage` |
| Bookmarks | `useBookmarks` store | `useSyncExternalStore` + `localStorage` |
| Search text | Local component state | `useState` in TrialsPage/MoleculesPage/SitesPage |
| Current page | URL | React Router |
| Active tab (trial detail) | Local component state | `useState` |
| Pagination | Local component state | `useState`, resets on filter change |

### Global filter store (`useTrialFilters`)

Filters live in a reactive store backed by `sessionStorage`. Any page can read or write filters. The `GlobalFilterBar` component (rendered in Layout, visible on all pages) shows active filters and allows removal.

When a `ChipLink` is clicked, it calls `useFilterNav` which:
1. Adds the filter to the global store
2. Navigates to `/trials`

This means filters **accumulate** across pages. Click a country on Sites, then a molecule on Molecules — both apply.

The `country` filter requires a server-side lookup (`useTrialsByCountry`) to resolve which NCT IDs have sites in that country. This is the only filter that requires a separate query; all others filter directly on trial data fields.

## Key Decisions

### Server-side SQL over client-side pagination
Initially all data was fetched via the WIP Document API (`listDocuments` with pagination). This was too slow for 88K+ AE documents and 25K+ sites. Switching to the WIP Reporting SQL API (PostgreSQL) made the Dashboard instant and trial detail tabs fast. The document API is still used for file downloads and namespace stats where SQL isn't needed.

### Global cumulative filters over URL-based filters
URL query params were the initial approach, but filters were lost on page navigation. The user wanted filters to accumulate across pages (click country on Sites, molecule on Molecules, see both on Trials). A `useSyncExternalStore`-based store with `sessionStorage` persistence solved this.

### All pages are filter-aware
Every page (Molecules, Sites, Bookmarks) derives its data from the filtered trial set via `useFilteredTrials`. This means the Molecules page shows only molecules appearing in trials matching the current filters, with adjusted counts. Same for Sites.

### Read-only app
No data entry in the UI. All data comes from ClinicalTrials.gov via the Python import script. Future: local data extensions (sample repository, internal notes) would be the first write feature.

### Bookmarks in localStorage
Bookmarks are client-side only (localStorage) with JSON export/import. This avoids needing a WIP template for user-specific data. If multi-user bookmarks are needed later, a CT_BOOKMARK template could be added.
