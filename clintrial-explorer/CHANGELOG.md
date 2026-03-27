# Changelog

## 2026-03-27 — Namespace migration and documentation update

### Changed
- Migrated COUNTRY terminology from `seed` namespace into `clintrials` namespace (hard-deleted old, re-created with 50 ISO country terms)
- Re-created all 6 templates to reference COUNTRY within `clintrials` namespace
- Formally registered `clintrials` namespace via Registry API
- Fixed SyncPage displaying "Namespace: clintrial" (now shows "clintrials")

### Verified
- All 101 ontology relationships intact (CT_THERAPEUTIC_AREA, CT_DRUG_CLASS, CT_MOLECULE, CT_TARGET hierarchies)
- All 9 terminologies (149 terms) active in `clintrials` namespace

### Docs
- Updated WIP_DEPENDENCIES.md: corrected namespace from `clintrial` to `clintrials`, COUNTRY no longer listed as `wip` namespace

## 2026-03-26 — Initial build complete

### Added
- Dashboard with 4 summary cards and 4 interactive charts (status donut, phase bars, top conditions, top molecules). All chart segments clickable — add to global filter.
- Trials page with paginated table, text search, quick filter dropdowns (status, phase, has results, bookmarked), CSV export, and expandable aggregate panel.
- Trial Detail page with 6 tabs: Overview, Outcomes, Sites, Adverse Events, Baseline, Documents. All entity references (molecules, conditions, sponsors, phases, countries) are clickable chips that add to the global filter.
- Molecules page showing molecule cards with trial counts, derived from filtered trial set.
- Sites page with country summary table (trial count, site count), sortable columns.
- Bookmarks with localStorage persistence, JSON export/import.
- Sync Status page showing WIP namespace stats and per-template document counts.
- Global cumulative filter system — filters persist across page navigation and accumulate when clicking entities on any page. Persistent filter bar visible on all pages.
- All pages are filter-aware: Molecules shows only molecules in matching trials, Sites shows only countries with matching trial sites.

### Architecture
- Server-side data fetching via WIP Reporting SQL API for Dashboard aggregations, trial detail tabs, and site statistics.
- Client-side filtering of trial list via shared `useFilteredTrials` hook.
- `@wip/client` used only for file downloads and namespace stats.
- Multi-stage Dockerfile (Node 20 build → Caddy 2 serve) with health endpoint.
- 11 unit tests covering bookmarks, trial-utils, and URL utilities.

### Known issues at launch
- Therapeutic areas not populated on trials (KNOWN_ISSUES.md #1)
- File downloads untested end-to-end (KNOWN_ISSUES.md #3)
