# Improvement Roadmap

Prioritized enhancement plan based on user feedback (2026-03-26).
Updated after therapeutic area classification was completed (2,508 trials classified).

## Core Problems

1. **Trial-centric architecture** — every interaction funnels to the Trials page. Entities like molecules, countries, and adverse events are filter selectors, not first-class objects.
2. **Single-select, forced redirect** — clicking a filter value selects one item and redirects to the Trials page. No multi-select, no stay-on-page.
3. **Limited filter dimensions** — only basic filters exist (status, phase, molecule, country). Missing: has AE data, has protocol PDF, has SAP, therapeutic area, and other data-availability filters.

## Completed

- ~~Therapeutic area classifier~~ — Done (2026-03-26). 2,508 of 3,867 trials classified via keyword matching against 37 CT_THERAPEUTIC_AREA terms. Script: `scripts/classify_therapeutic_areas.py`.
- ~~Global cumulative filters~~ — Done. Filters persist across pages via sessionStorage.
- ~~Server-side SQL queries~~ — Done. Dashboard, trial detail, sites all use reporting layer.
- ~~Filter-aware pages~~ — Done. Molecules and Sites reflect active filters.
- ~~Selected item highlighting~~ — Done. Active molecule/country visually highlighted.

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

### 1c. Richer trial filters
**Priority:** High — directly requested
**Effort:** Medium

Add data-availability filters to the Trials page and global filter bar:

| Filter | Logic | Data source |
|--------|-------|-------------|
| Has AE data | Trial has rows in doc_ct_trial_ae | `SELECT DISTINCT nct_id FROM doc_ct_trial_ae` |
| Has results/outcomes | Trial has rows in doc_ct_trial_outcome with result_groups | Reporting SQL |
| Has baseline data | Trial has rows in doc_ct_trial_baseline | Reporting SQL |
| Has protocol PDF | Trial has linked PDF file of type "protocol" | File references (once PDFs are imported) |
| Has SAP PDF | Trial has linked PDF file of type "statistical analysis plan" | File references (once PDFs are imported) |
| Therapeutic area | Now populated on 2,508 trials | Direct field filter (multi-select) |
| Enrollment range | Min/max enrollment slider | Direct field filter |
| Date range | Start date between X and Y | Direct field filter |

The "has PDF" filters depend on importing trial documents (KNOWN_ISSUES #3). The others can be implemented now.

**Implementation:** Pre-compute the sets of NCT IDs that have AE/outcome/baseline data via SQL queries (similar to the existing `useTrialsByCountry` pattern). Cache with 5-min stale time. Filter client-side against the trial list.

## Phase 2: Content Pages (unblocked by TA classification)

### 2a. Therapeutic Area hierarchy view
**Priority:** High — now unblocked
**Effort:** Medium

Each therapeutic area is a collapsible section that expands to show all trial conditions it covers. Clicking a condition filters trials. Shows the mapping between curated areas and raw ClinicalTrials.gov conditions.

Could live on a dedicated page (`/therapeutic-areas`) or as an expandable panel on the Dashboard.

Additionally shows:
- Number of trials per area (and per condition within the area)
- Unclassified conditions (the 35% of trials with no therapeutic area match)
- Which keywords triggered the classification (transparency)

### 2b. Dashboard filter-awareness
**Priority:** High — quick win
**Effort:** Low (30 min)

Dashboard charts currently always show the full dataset. Add WHERE clauses to the 7 SQL queries based on active filters. Dashboard becomes another lens on the filtered dataset. Now that therapeutic areas are populated, add a therapeutic area chart.

### 2c. Molecule Detail Page (`/molecules/:name`)
**Priority:** High — leverages existing terminology data
**Effort:** Medium

| Section | Data Source |
|---------|------------|
| Name + aliases (brand names, company codes) | CT_MOLECULE term aliases |
| Drug class | CT_DRUG_CLASS ontology relationships |
| Molecular targets | CT_TARGET ontology relationships |
| Trial summary (by phase, status) | Reporting SQL aggregation |
| Therapeutic areas | From classified trials using this molecule |
| Aggregate AE profile | Reporting SQL on doc_ct_trial_ae |
| Trial list | Filtered trial list component |

### 2d. Condition normalization via CT_CONDITION terminology
**Priority:** High — conditions are the most visible data quality issue
**Effort:** High (data model change)

ClinicalTrials.gov conditions are free text with rampant duplication: 79 distinct spellings for "lung cancer" variants alone ("Non-Small Cell Lung Cancer" vs "Non-small Cell Lung Cancer" vs "NSCLC" vs "Carcinoma, Non-Small-Cell Lung" vs Unicode-comma variants).

**Implementation:**
1. Create a `CT_CONDITION` terminology with curated canonical terms and aliases (like CT_MOLECULE)
2. Build a condition resolver in the import script that maps free-text conditions to CT_CONDITION terms
3. Store resolved condition term values on the trial document (alongside or replacing the raw conditions array)
4. Unresolved conditions flagged for manual curation
5. This is a Phase 2/3 data model change — new terminology, new/modified template field, re-import

**Interim fix (done):** Display-time normalization groups condition strings by lowercase/stripped form while showing the most common spelling. Doesn't fix the data but makes charts and lists usable.

## Phase 3: Advanced Exploration

### 3a. Adverse Events Page (`/adverse-events`)
**Priority:** Medium-High — high value, high effort
**Effort:** High

| Section | Description |
|---------|-------------|
| Top AEs | Most frequent AEs across filtered trials, sortable by incidence |
| Organ system grouping | Collapsible, with serious/other toggle |
| Drill-down | Click AE term → which trials reported it, per-arm stats |
| Cross-trial comparison | Heatmap: AE terms × trials (or molecules), cells = incidence |
| Filter-aware | Respects global filters |

Data source: Reporting SQL on `doc_ct_trial_ae` with GROUP BY aggregation.

### 3b. Mapping rules transparency and configuration
**Priority:** Medium-High
**Effort:** Short-term Low, Long-term High

The therapeutic area classifier, ontology relationships (drug class → molecule, molecule → target), and similar mapping rules are currently invisible to the user.

**Short-term: Read-only visibility**
- A "Data Model" or "Configuration" page showing:
  - Therapeutic area → condition keyword mapping (which keywords map to which area, how many trials each rule matched)
  - Molecule → drug class relationships (from CT_DRUG_CLASS ontology)
  - Molecule → target relationships (from CT_TARGET ontology)
  - Unmatched conditions (trials with no therapeutic area — helps identify gaps)
- Transparency feature: user can see exactly why a trial is classified as "Lung Cancer" and spot misclassifications or missing rules.

**Long-term: User-configurable rules**
- Edit keyword mappings through the UI (add/remove keywords per therapeutic area)
- Add new therapeutic area terms
- Run re-classification from the UI (trigger the classifier script, show progress)
- Preview changes before applying ("if I add this keyword, which trials would be reclassified?")
- Audit trail: who changed which rule, when, and how it affected classification

**Data source:** All mapping rules already live in WIP as terminology terms (with aliases) and ontology relationships. The short-term view reads what's there. The long-term edit UI writes back via `@wip/client`.

## Phase 4: Polish

### 4a. Country Detail Page (`/sites/:country`)
**Priority:** Low — Sites page with filters covers most use cases
**Effort:** Medium

Summary stats, facility list, trial timeline for a country.

### 4b. Bookmarks as WIP documents
**Priority:** Low — current localStorage approach works for single-user
**Effort:** Medium

Create a CT_BOOKMARK template in WIP. Enables multi-device sync and sharing.

### 4c. Import trial PDFs from ClinicalTrials.gov
**Priority:** Low — prerequisite for "Has protocol PDF" / "Has SAP" filters
**Effort:** Medium

Download protocol documents, SAPs, and other PDFs from ClinicalTrials.gov API. Upload to WIP file store. Link to trial documents. See KNOWN_ISSUES.md #3.

## Deferred

- E2E tests with Playwright
- Docker Compose integration with WIP ecosystem
- Gateway registration and portal listing
