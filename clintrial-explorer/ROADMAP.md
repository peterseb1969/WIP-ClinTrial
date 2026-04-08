# Improvement Roadmap

Current state of the ClinTrial Explorer application. Last updated 2026-04-08.

The app is well past its initial scope. Most of the original roadmap has shipped. This document tracks what's left and what's been added since the original plan.

## Status Summary

| Phase | Status |
|-------|--------|
| Phase 1 — Filter Model | ✅ Shipped |
| Phase 2 — Content Pages | ✅ Mostly shipped (1 item open) |
| Phase 3 — Advanced Exploration | ✅ Shipped |
| Phase 4 — Polish | Partial (low-priority items deferred) |
| New work added since original plan | See "Beyond the Original Plan" |

---

## Open Items

### High value

#### Ontology-aware classification
**Priority:** High — closes a real semantic gap
**Effort:** Small

The classifier currently does flat condition→TA matching. When a rule matches "breast cancer" and adds `BREAST_CANCER`, it does **not** also add `ONCOLOGY`, even though `BREAST_CANCER --is_a--> ONCOLOGY` is declared in the ontology. The ontology data is in WIP and unused at classification time.

**Implementation:**
1. Server-side classifier (`server/lib/classifier.ts`) loads `is_a` ancestors from `CT_THERAPEUTIC_AREA` once per classification run via `list_relationships` / `get_term_hierarchy`
2. After flat rule matching produces a set of leaf TAs, walk ancestors and add them to the result
3. Provenance tracking notes which TAs were inherited vs. matched directly
4. Frontend `applyRules` does the same for live preview/dry-run mode (preload the ancestor map at app start)
5. Add a UI hint on the classification page: "Ontology hierarchy applied — N inherited TAs"

**Benefit:** Aggregations like "all oncology trials" stop needing to OR together every leaf TA. Dashboard, filter bar, and analytics all become hierarchical for free.

#### CT_CONDITION terminology and condition resolver
**Priority:** High — biggest remaining data quality issue
**Effort:** High (data model change + re-import)

Conditions from ClinicalTrials.gov are free text with rampant duplication: dozens of spellings for "non-small cell lung cancer," Unicode-comma variants, qualifier ordering differences. Display-time normalization (already in place) papers over the issue but doesn't fix it.

**Implementation:**
1. Create `CT_CONDITION` terminology with curated canonical terms and aliases (mirror of `CT_MOLECULE`)
2. Build a resolver in the import pipeline that maps free-text conditions to canonical CT_CONDITION terms
3. Add a `resolved_conditions` field to `CT_TRIAL` (alongside the raw `conditions` array)
4. Unresolved conditions surface in the classification rules page as a curation queue
5. Re-run import to backfill

This is a Phase 2/3 data model change — touches templates, terminologies, the import pipeline, and existing documents.

### Medium value

#### Enrollment range slider filter
**Priority:** Medium — quick win
**Effort:** Small

Add min/max enrollment slider to the global filter bar. Direct field filter, no SQL changes needed.

#### Date range filter
**Priority:** Medium
**Effort:** Small

Add start-date range filter to the global filter bar. Same shape as enrollment.

#### Therapeutic Area page — true hierarchy view
**Priority:** Medium
**Effort:** Small (depends on ontology-aware classification)

The current `TherapeuticAreasPage` lists areas flat. Once classification is ontology-aware, expand it to show the actual `is_a` tree with collapsible parent nodes and trial counts at each level.

### Low value (deferred)

#### Country Detail Page (`/sites/:country`)
**Priority:** Low
**Effort:** Medium

Summary stats, facility list, trial timeline for a single country. The Sites page with country filters covers most use cases — only worth doing if a user explicitly asks.

#### Bookmarks as WIP documents
**Priority:** Low
**Effort:** Medium

Bookmarks currently use localStorage (works fine for single-user). Migrating to a `CT_BOOKMARK` template in WIP would enable multi-device sync and sharing, but no current user has asked for it.

#### E2E tests with Playwright
**Priority:** Low
**Effort:** Medium

Existing unit/integration coverage via Vitest is reasonable. Playwright would catch UI regressions but adds CI complexity.

---

## Beyond the Original Plan

Significant features and fixes shipped that weren't on the original roadmap.

### Shipped

- **In-app import pipeline** — full ClinicalTrials.gov ingest from the UI with SSE progress, sync state tracking, country auto-creation, per-trial error isolation, and persistent error log. Replaces the CLI-only import script.
- **Persistent classification** — rules stored in WIP via `CT_CLASSIFICATION_RULE` template. Classification engine on the server with provenance tracking. Pin/unpin per trial protects manual TA edits from re-classification.
- **AE term normalization via mutable terminology** — `CT_AE_TERM` mutable terminology with in-app term manager, alias merging, and resolution layer for charts and aggregations.
- **Protocol PDF pipeline** — 863 PDFs imported from ClinicalTrials.gov to WIP file store. "Has protocol PDF" / "Has SAP" filters wired up.
- **Molecule Compare Page** — side-by-side comparison of multiple molecules across trials, indications, AEs.
- **CSV export** on every page with tabular data.
- **SQL Inspector** — view and run reporting queries directly from the UI.
- **Bulk import + offline download** of trial sets for analysis.

### Open / pending decisions

- **Bootstrap from UI** — fresh-install wizard that connects to any WIP instance and runs bootstrap from the seed files. Analysis complete; not yet started. Requires runtime WIP config + dynamic proxy.
- **Backup / restore via UI** — waiting on platform decision (CASE-23). Platform is shipping this in WIP v1.0 wrapping `wip-toolkit`. The app will get a thin "Backup" / "Restore" UI on top once endpoints land. Do not build a parallel implementation.
- **K8s deployment** — deferred until localhost is fully solid. Once Bootstrap from UI lands, fresh K8s deploys become trivial.

---

## Cross-cutting Notes

- Roadmap status reflects code on `main` as of 2026-04-08. If you ship something, update this file in the same PR.
- "Done" items removed from the active list to keep the document scannable. Git history is the source of truth for what was built and when.
