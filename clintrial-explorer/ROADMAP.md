# Improvement Roadmap

Prioritized enhancement plan based on user feedback (2026-03-26).

## Core Problem

The app is trial-centric: every interaction funnels to the Trials page. Entities like molecules, countries, and adverse events are treated as filter selectors, not as first-class objects. Single-select filters with forced page redirect make multi-criteria browsing tedious.

## Phase 1: Fix the Filter Model

### 1a. Multi-select filters
**Priority:** Critical — architectural foundation
**Effort:** Medium

Change filter values from `string` to `string[]`. A user can select US + CH + DE as countries, or atezolizumab + bevacizumab as molecules. The filter bar shows multiple chips per key. Client-side filtering uses `some`/`includes` instead of `===`.

**Changes:** `useTrialFilters` store, `useFilteredTrials` hook, `GlobalFilterBar`, `useTrialsByCountry` (needs to accept multiple countries), all quick filter controls on TrialsPage.

### 1b. Stay-on-page selection
**Priority:** Critical — UX foundation
**Effort:** Medium

Clicking a molecule/country/status toggles it in the global filter *without navigating away*. The current page re-renders with the updated filter. Each page gets a "View N matching trials →" button for explicit navigation to the trial list.

**Changes:** `useFilterNav` → `useFilterToggle`. ChipLink stays on current page. Molecules/Sites/Dashboard pages add a "View trials" action.

## Phase 2: Quick Wins

### 2a. Dashboard filter-awareness
**Priority:** High — quick win after Phase 1
**Effort:** Low (30 min)

Dashboard charts currently always show the full dataset. After Phase 1, add WHERE clauses to the 7 SQL queries based on active filters. Dashboard becomes another lens on the filtered dataset.

### 2b. Therapeutic area classifier in import script
**Priority:** High — unblocks hierarchy view
**Effort:** Medium

Build keyword classifier that maps trial `conditions` to `CT_THERAPEUTIC_AREA` terms using term values, labels, and aliases. Re-import with `--full`. See KNOWN_ISSUES.md #1 for full implementation plan.

## Phase 3: Entity Detail Pages

### 3a. Molecule Detail Page (`/molecules/:name`)
**Priority:** High — leverages existing terminology data
**Effort:** Medium

| Section | Data Source |
|---------|------------|
| Name + aliases (brand names, company codes) | CT_MOLECULE term aliases |
| Drug class | CT_DRUG_CLASS ontology relationships |
| Molecular targets | CT_TARGET ontology relationships |
| Trial summary (by phase, status) | Reporting SQL aggregation |
| Conditions/therapeutic areas | Derived from trial conditions |
| Aggregate AE profile | Reporting SQL on doc_ct_trial_ae |
| Trial list | Filtered trial list component |

### 3b. Therapeutic Area hierarchy view
**Priority:** Medium — depends on 2b (classifier)
**Effort:** Medium

Each therapeutic area is a collapsible section that expands to show all trial conditions it covers. Clicking a condition filters trials. The hierarchy makes the relationship between the curated therapeutic areas and the raw ClinicalTrials.gov conditions visible and browsable.

Could live on a dedicated page (`/therapeutic-areas`) or as an expandable section on the Dashboard.

### 3c. Adverse Events Page (`/adverse-events`)
**Priority:** Medium-High — high value, high effort
**Effort:** High

| Section | Description |
|---------|-------------|
| Top AEs | Most frequent AEs across filtered trials, sortable by incidence |
| Organ system grouping | Collapsible, with serious/other toggle |
| Drill-down | Click AE term → which trials reported it, per-arm stats |
| Cross-trial comparison | Heatmap: AE terms × trials (or molecules), cells = incidence |
| Filter-aware | Respects global filters |

Data source: Reporting SQL on `doc_ct_trial_ae` with GROUP BY aggregation. The 88K records are fast to aggregate server-side but the UI needs careful design to avoid overwhelming the user.

## Phase 4: Polish

### 4a. Country Detail Page (`/sites/:country`)
**Priority:** Low — Sites page with filters covers most use cases
**Effort:** Medium

Summary stats, facility list, trial timeline for a country. Nice to have, not essential.

### 4b. Bookmarks as WIP documents
**Priority:** Low — current localStorage approach works for single-user
**Effort:** Medium

Create a CT_BOOKMARK template in WIP. Enables multi-device sync and sharing. Only worth doing if multi-user access is needed.

## Deferred

- E2E tests with Playwright (Phase 4 of original build plan)
- Docker Compose integration with WIP ecosystem
- Gateway registration and portal listing
