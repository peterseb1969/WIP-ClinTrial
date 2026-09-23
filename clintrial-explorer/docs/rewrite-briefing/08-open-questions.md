# 8. Open Questions for Rewrite

## Known Gaps (Not Yet Implemented)

### Cross-Source Entity Consolidation
Molecule names, therapeutic areas, disease areas, and indications exist in different forms across the three data sources. No consolidation layer exists yet.

**Examples:**
- ClinicalTrials.gov: "bevacizumab" vs TA Portal: "Avastin" vs SAMI: "BEV"
- ClinicalTrials.gov conditions vs TA Portal indications — overlapping but not identical
- ClinicalTrials.gov sponsor names vs TA Portal accountable party

**Planned approach was:** Similar to eligibility normalization — export, cluster, human review, build mapping documents. A rewrite could design this as a first-class entity resolution layer.

### Eligibility Re-Extraction Pipeline
Source hash tracking is in place (v3 template, MD5 of source text stored at extraction time, staleness dashboard on the dashboard page). But no automated re-extraction pipeline exists — extraction is currently a manual one-shot process.

**For rewrite:** Should extraction be a scheduled background job? Triggered on source data change? Incremental (only stale trials)?

### Curation Queue Completion
~2,900 fuzzy match candidates (TA Portal ↔ ClinicalTrials.gov) still need human review. The curation UI exists but is not exposed in the main navigation (page exists, route not registered).

### CT_CLASSIFICATION_RULE as Documents
Classification rules are stored in code/seed data, not as CT_CLASSIFICATION_RULE documents in WIP. The template exists and the UI supports CRUD, but the rules are applied client-side from a mix of sources.

### TA Portal Products
CT_TA_PRODUCT and CT_TA_STUDY_PRODUCT templates exist but are unpopulated. Product-to-study linking was designed but never loaded.

---

## Design Questions for the Rewrite

### 1. Data Curation as a First-Class Concept
The current app bolted on normalization and curation after the core was built. A rewrite should decide:
- Is curation a workflow (queue-based, with review/approve/reject states)?
- Or is it a configuration layer (rules that transform data at ingest/query time)?
- Who curates — scientists, data stewards, or AI + human review?
- How do curation decisions propagate (immediately vs. batch)?

### 2. Query Performance Strategy
Current approach: bulk-load all trials client-side + on-demand SQL for sub-entities. Alternatives:
- Server-side filtering with API pagination (traditional)
- Materialized views for common aggregations
- Search index (Elasticsearch/Typesense) for faceted search
- GraphQL for flexible sub-entity loading
- Pre-computed statistics tables

### 3. Multi-Source Integration Pattern
Current: three separate import paths, query-time JOINs on shared keys. Alternatives:
- Unified data lake with source attribution
- Entity resolution as a pre-processing step (build a canonical ID for each study)
- Event-driven integration (source updates trigger downstream transforms)
- Master data management pattern (golden record per entity)

### 4. Normalization Timing
Current app has a mix of write-time and query-time normalization. A rewrite should pick a strategy:
- **Write-time everywhere:** Best query performance, expensive to update mappings
- **Query-time everywhere:** Maximum flexibility, may have JOIN overhead
- **Hybrid with re-materialization:** Write-time for performance, with a "re-normalize" pipeline triggered by mapping changes

### 5. Eligibility Data Model
Current: flat booleans + JSON criteria array. Alternatives:
- Fully structured: each criterion type has its own template/table
- Ontology-backed: criteria linked to medical ontology terms (MedDRA, SNOMED)
- Graph-based: criteria as nodes with typed relationships (requires, excludes, allows)

### 6. Sample-Centric vs. Trial-Centric
The current app is trial-centric (trials are the primary entity, samples are a sub-view). But the primary user (biobank scientist) thinks sample-first: "I need plasma from NSCLC patients collected at baseline." A rewrite could invert the hierarchy.

### 7. Technology Independence
The current app is tightly coupled to WIP as the storage backend. A rewrite should decide:
- Continue with WIP (mature, handles terminology/versioning/reporting)
- Use WIP for reference data + a dedicated database for transactional data
- Move to a different backend entirely (PostgreSQL + application layer)

### 8. AI Integration Strategy
Current AI usage is ad-hoc:
- Eligibility extraction: one-shot batch via Claude subagents
- AE cleanup: on-demand AI suggestions via Anthropic API
- TA classification: LLM-assisted rule suggestions

A rewrite could design AI as a pipeline stage: source data → AI enrichment → human review → canonical store.

---

## Data Volumes for Capacity Planning

| Entity | Current | Growth Trajectory |
|--------|---------|-------------------|
| Trials | 4,155 | ~100-200/year (Roche-sponsored) |
| AE records | 94,778 | Grows with trials posting results |
| Sample rows | 48,975 | Grows with new SAMI exports |
| TA Portal studies | 5,554 | Grows slowly (~200/year) |
| Eligibility extractions | 4,118 | 1:1 with trials |
| Normalization mappings | 14,597 | Grows as new patterns appear |
| Total documents | ~249,000 | ~260k in 1 year |

Growth is modest — this is not a high-volume system. The rewrite should optimize for query flexibility and curation workflow quality, not raw throughput.
