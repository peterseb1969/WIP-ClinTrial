# 5. User Features

## Navigation

Sidebar with 12 entries: Dashboard, Trials, Molecules, Therapeutic Areas, Adverse Events, Sites, Bookmarks, Samples, Populations, TA Portal, Settings, Import (admin only).

A global filter bar appears on every page — active filters show as chips, and all pages share the same filtered trial set. Filters include: status, phase, molecule, therapeutic area, condition, sponsor, country (multi-select), plus toggles for has_results, has_AE_data, has_samples, eligibility criteria (FTS), and deep search.

---

## Dashboard (`/`)

Overview of the trial portfolio.

**Metrics:** 4 summary cards (total trials, bookmarked, with results, recruiting). Click any card to navigate or filter.

**Data quality:** SAMI sample stats bar (trials with samples, total samples). Eligibility extraction coverage bar (extracted/pending/stale with progress indicator).

**Charts:** Status donut, phase bar chart, top 15 therapeutic areas, top 15 molecules, top 15 conditions. Click any chart segment to activate that global filter.

---

## Trials (`/trials`)

Searchable, filterable list of all clinical trials.

**Search:** Quick text filter (NCT ID, Roche ID, title, conditions, molecules). Deep full-text search (PostgreSQL FTS on full trial record).

**Table:** Paginated (25/page). Columns: NCT ID, brief title, status badge, phase, sponsor, enrollment, start date, results indicator, samples indicator. Bookmark button per row.

**Export:** CSV of filtered results.

**Workflow:** Browse → filter → find trial → click row → trial detail page.

---

## Trial Detail (`/trials/:nctId`)

Full detail for a single trial. 6 tabs:

| Tab | Content |
|-----|---------|
| Overview | Title, status, phase, dates, enrollment, conditions, interventions (as clickable chip links), description, raw + structured eligibility criteria |
| Outcomes | Primary/secondary outcome measures with statistical results |
| Sites | Per-site facility, city, country, status |
| Adverse Events | AE table with severity, group breakdown |
| Baseline | Demographic and disease characteristics |
| Documents | Linked PDFs with download |

**Actions:** Bookmark. Pin/unpin TA. Add therapeutic area inline. Link to ClinicalTrials.gov.

---

## Molecules (`/molecules`)

Browse molecules (interventions) across all trials.

**List view:** Each molecule shows trial count, phase distribution, top conditions. Search and filter.

**Comparison:** Select 2+ molecules for side-by-side comparison.

**Detail page** (`/molecules/:name`): Trial list, phase distribution, top conditions, AE profile.

**Comparison page** (`/molecules/compare`): AE heatmap — rows = AE terms, columns = molecules, cells = incidence percentage. Color-coded by severity. Shows trial overlap. CSV export.

---

## Therapeutic Areas (`/therapeutic-areas`)

Browse the TA ontology tree with trial counts.

**Tree view:** Expandable parent → child hierarchy. Per-node trial count and top conditions.

**TA Manager panel:** Create/edit terms in CT_THERAPEUTIC_AREA terminology, assign parent terms.

**Classification Rules link** (`/settings/rules`): Manage condition → TA mapping rules. Add/edit/delete rules. Test rules against the trial corpus (preview which trials would be affected).

---

## Adverse Events (`/adverse-events`)

Cross-trial AE analytics.

**Three view modes:** Flat list, organ-system hierarchy, grouped by molecule/TA.

**Features:**
- Filter by category (all/serious/other)
- Search AE terms
- Term resolution (raw strings → canonical MedDRA-like terms)
- AE cleanup modal (AI-assisted deduplication suggestions)
- Severity distribution chart
- Drill-down panel per term showing per-trial breakdown
- CSV export

---

## Sites (`/sites`)

Geographic analysis of trial sites.

**Table:** Country-level aggregation — trial count, site count, total enrollment per country. Sort by any column. Click country to filter globally. CSV export.

---

## Bookmarks (`/bookmarks`)

User's bookmarked trials. localStorage-backed.

**Features:** List of bookmarked trials with key details. Export/import bookmarks as JSON (clipboard). Remove individual bookmarks.

---

## Samples (`/samples`)

Browse biobank sample inventory (SAMI data).

**Summary view:** Per-study sample breakdown by type (plasma, serum, blood, DNA, etc.) with availability counts.

**Filters:** Search (study #/NCT ID), sample type checkboxes, minimum available threshold.

**Detail view:** Expand row to see per-timepoint breakdown with:
- Phase badges (SCREENING, BASELINE, ON_TREATMENT, etc.) — color-coded
- Chronological sorting: phase order → seconds within phase
- Raw clinical event label

**Study basket:** Add/remove studies, shared with Population Explorer via localStorage. Clear all.

**Export:** CSV (summary or detailed).

---

## Population Explorer (`/populations`)

Find trials by study population characteristics for sample selection. Three-panel layout:

### Left Sidebar: Profile Builder
Build a "desired population" profile:
- Age range (min/max)
- ECOG performance status range
- Molecule typeahead search
- "Samples only" toggle (default: show only trials with SAMI data)
- Exclusion toggles: HIV, CNS mets, autoimmune, pregnancy
- Requirements: measurable disease, healthy volunteers
- Full-text search on eligibility text

### Center: Criteria Browser
Server-side criteria group browser:
- Groups criteria by semantic group (43 groups)
- Type filter: inclusion / exclusion / all
- Search within criteria
- Expand group → see individual criteria with trial count
- Click a criterion → filter the trial list to matching trials
- Hides empty groups when filtering

### Bottom: Study Results
Matched trials with:
- Match score (green/amber/red) based on profile vs. eligibility
- Trial metadata (NCT ID, title, conditions, molecules, samples)
- Study basket integration (add/remove, shared with Samples page)
- Trial comparison matrix: side-by-side eligibility for 2–5 selected trials

---

## TA Portal (`/roche-studies`)

Browse studies from the internal TA Portal data source.

**Table:** Study number, phase, status, type, TA, disease area, indication, molecule. Column-level text filters. Expand row for full detail.

---

## Settings (`/settings`)

App configuration:
- Auto-sync toggle and interval (scheduled ClinicalTrials.gov import)
- Anthropic API key management (for AI features)
- Classification rules link
- Last sync status

---

## Import (`/import`) — Admin Only

Manual data import hub:

**ClinicalTrials.gov:** Mode (incremental/full), sponsor filter, NCT ID list, since-date, limit, skip-PDFs toggle. SSE-streamed progress with cancel button.

**Other sources:** TA Portal study CSV upload, SAMI summary/detail CSV upload, orphan file linker.

**Status:** Namespace stats (document counts per template), last sync state.

---

## Cross-Page Patterns

| Pattern | Where Used |
|---------|-----------|
| Global filter state (URL-backed) | All pages — filters persist across navigation |
| Study basket (localStorage) | Samples + Population Explorer — add studies on one page, view on the other |
| Clickable chips (conditions, molecules) | Trial detail, molecules page — click to add as global filter |
| CSV export | Trials, molecules, AEs, sites, samples, comparison matrix |
| SQL Inspector | Developer tool — shows the SQL behind any data view |
| SSE streaming | Import, bootstrap — real-time progress updates |
