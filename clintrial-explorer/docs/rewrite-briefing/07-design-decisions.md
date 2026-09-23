# 7. Design Decisions & Lessons

Decisions made during development, what worked, what didn't, and what a rewrite should reconsider.

---

## What Worked Well

### Bulk load all trials client-side
Loading all ~4,100 trials into the client enables instant filtering without round-trips. At this scale (~4MB), it's fast and simple. The global filter state works across all pages because every page shares the same in-memory dataset.

**Rewrite consideration:** This approach has a ceiling. At 10k+ trials, payload size and client-side enrichment cost become noticeable. A rewrite should decide: keep the bulk-load pattern (if trial count stays bounded), or move to server-side filtering (if growth is expected).

### Query-time normalization for visit/timepoints
Visit/timepoint normalization is a query-time LEFT JOIN rather than a write-time transformation. This means updating the mapping table (fixing a regex, adding a new event string) takes effect immediately without re-importing SAMI data.

**Lesson:** Query-time normalization wins when the mapping is still being refined and data is expensive to re-import.

### Identity-based upsert for idempotent imports
WIP's identity hash system means re-importing the same data is a no-op — only changed data creates new document versions. This makes imports safe to re-run and simplifies error recovery.

### Server-side criteria browser via jsonb_array_elements
Moving the criteria browser from client-side aggregation (limited to 100 array elements per document by the reporting layer) to server-side SQL queries using `jsonb_array_elements` on the native criteria array removed the hard limit and improved performance.

### Seed data in git for reproducibility
Committing normalization mapping CSVs to the repository and loading them at bootstrap means a fresh install produces the same normalized state without manual re-running of normalization pipelines.

---

## What Didn't Work / Pain Points

### Client-side TA enrichment
TA classification runs in the browser on every page load. This means:
- ~4,100 trials × rule set × ontology walk runs in useMemo on every filter change
- Rules and ontology are fetched separately
- Pinned trials require a flag check per trial

**Lesson:** Classification should be materialized at write-time (on import or rule change), not computed on every render. The current approach grew from "let's try a few rules" to a full classification engine, but it never moved to server-side.

### Write-time eligibility normalization
Category dedup, semantic grouping, and SV key consolidation are baked into the extraction output. Changing the mapping rules requires re-extracting all 4,118 trials. This made iteration slow during the normalization design phase.

**Lesson:** For a rewrite, consider storing raw extraction output and applying normalization at query-time (like visit/timepoints), or at least make re-normalization a lightweight operation separate from re-extraction.

### Template versioning friction
WIP templates are versioned. Adding a field (e.g., `source_hash` to eligibility, or `criteria` array to eligibility) creates a new version. Existing documents remain on the old version. The reporting layer creates per-version tables. This means:
- Entity views don't include new-version-only columns
- Migration is needed to move documents to the new version
- Queries sometimes need to target specific version tables

**Lesson:** Design the data model carefully upfront. Schema evolution works but has operational cost.

### No pre-materialized cross-source edges
All cross-source relationships are query-time JOINs on shared keys (org_study_id, nct_id). This works but means:
- JOIN performance depends on index quality
- No way to traverse relationships without knowing the join key
- Cross-source queries require knowing which tables to join and on which fields

**Lesson for rewrite:** Consider whether formal relationship edges (WIP edge types or a graph layer) would simplify cross-source queries.

### Three import mechanics
CT.gov: automated API pipeline. SAMI: manual CSV upload. TA Portal: manual CSV upload. Each has different code paths, error handling, and progress reporting.

**Lesson:** A unified import abstraction (source adapter + common pipeline) would reduce code duplication and make adding new sources easier.

---

## Key Tradeoffs Encountered

### FTS on JSON string vs. native array
Eligibility criteria are stored both as a JSON-stringified string (`criteria_json`, FTS-indexed) and as a native array field (`criteria`, queryable via jsonb_array_elements). The duplication exists because:
- FTS on the JSON string enables full-text search across all criteria text
- The native array enables per-criterion SQL queries (GROUP BY semantic_group, etc.)
- WIP's reporting layer didn't originally support FTS on array fields

**For rewrite:** Consider whether the storage backend supports FTS on structured array data natively, eliminating the duplication.

### Extensible vs. immutable terminologies
Some terminologies (COUNTRY, CT_MOLECULE) are extensible — new terms are created on the fly during import when unknown values appear. Others (CT_STATUS, CT_PHASE) are immutable. Extensible terminologies grow unbounded and may need periodic cleanup.

**For rewrite:** Define a clear policy for each vocabulary: controlled (curated, finite) vs. open (grows with data).

### Sample aggregation granularity
The original SAMI template (CT_SAMI_STUDY_SUMMARY) aggregated at study × sample_type. When per-timepoint data was needed, a new template (CT_SAMI_STUDY_DETAIL) was created at study × sample_type × clinical_event granularity. Both exist.

**Lesson:** Design the lowest useful granularity from the start. Aggregation is cheap; disaggregation requires new data.

---

## Scalability Observations

| Dimension | Current | Concern |
|-----------|---------|---------|
| Total trials | 4,155 | Manageable for client-side bulk load |
| AE records | 94,778 | SQL queries return fast with proper indexing |
| Sample rows | 48,975 | JOIN with mapping table (~10k rows) is fast |
| Criteria array | up to ~100 items per trial | jsonb_array_elements scales linearly |
| Normalization mappings | 14,597 | Loaded once, cached, no performance issue |
| Client-side enrichment | 4,100 trials × rules | Runs in <500ms currently, but is O(n×m) |
| Full-text search | tsvector/GIN index | Fast for eligibility text, not available for all fields |
