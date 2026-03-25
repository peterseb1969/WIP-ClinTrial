# Clinical Trials Explorer

A read-only browser for Roche/Genentech clinical trial data imported from ClinicalTrials.gov. Browse ~2,600 trials, filter by status/phase/molecule/country, drill into trial details (outcomes, sites, adverse events, baseline demographics), bookmark trials, and explore the molecule pipeline.

## Pages

- **Dashboard** — Summary cards and charts (status, phase, conditions, molecules). All segments clickable.
- **Trials** — Paginated table with search and quick filters. CSV export. Aggregate panel.
- **Trial Detail** (`/trials/:nctId`) — 6-tab view: Overview, Outcomes, Sites, Adverse Events, Baseline, Documents. All entities are clickable chips that add to the global filter.
- **Molecules** — Card grid of molecules derived from trial interventions, with trial counts.
- **Sites** — Country summary table with trial/site counts, sortable.
- **Bookmarks** — localStorage-backed bookmarks with JSON export/import.
- **Sync** — Read-only view of WIP namespace stats and per-template document counts.

## Global Filters

Filters are cumulative across pages. Click a country on Sites, then a molecule on Molecules — both filters apply everywhere. A persistent blue filter bar appears on all pages when filters are active. Filters persist in `sessionStorage` across page navigation within a session.

## How to Run

```bash
cd clintrial-explorer
cp .env.example .env          # Edit if WIP is not on localhost:8443
npm install
npm run dev                    # http://localhost:3001/apps/clintrial
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_WIP_HOST` | `https://localhost:8443` | WIP API base URL (used by Vite proxy, not sent to browser) |
| `VITE_WIP_API_KEY` | `dev_master_key_for_testing` | API key for WIP authentication |
| `VITE_BASE_PATH` | `/apps/clintrial` | URL prefix for gateway integration |
| `VITE_APP_PORT` | `3001` | Dev server port |

The browser client always uses the same origin (empty `baseUrl`). Vite's dev proxy forwards `/api/*` requests to `VITE_WIP_HOST`.

## WIP Prerequisites

The following must exist in WIP before the app will show data:

- **Terminologies:** CT_PHASE, CT_STATUS, CT_STUDY_TYPE, CT_OUTCOME_TYPE, CT_THERAPEUTIC_AREA, CT_DRUG_CLASS, CT_TARGET, CT_MOLECULE, COUNTRY
- **Templates:** CT_TRIAL, CT_ORGANIZATION, CT_TRIAL_OUTCOME, CT_TRIAL_SITE, CT_TRIAL_AE, CT_TRIAL_BASELINE
- **Data:** Imported via `python scripts/import_trials.py`

Seed files are in `data-model/terminologies/` and `data-model/templates/`.

## Tech Stack

| Concern | Choice |
|---------|--------|
| Framework | React 18, TypeScript |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 |
| Icons | Lucide React |
| Data fetching | TanStack Query 5 + `@wip/react` hooks |
| Charts | Recharts |
| Routing | React Router v6 |
| WIP client | `@wip/client` + `@wip/react` (from `World-in-a-Pie/libs/`) |
| Server queries | WIP Reporting-Sync SQL API (PostgreSQL) |
| Production | Multi-stage Docker (Node 20 build → Caddy 2 serve) |

## Tests

```bash
npm test          # 11 unit tests (vitest + jsdom)
```
