# 4. Normalization & Curation

Six distinct normalization pipelines, plus a human curation workflow. Each has different application timing (write-time vs. query-time), different storage, and different update mechanics.

---

## Pipeline 1: Eligibility Criteria Extraction

### Problem
ClinicalTrials.gov eligibility criteria are free text (often 2–5 pages). Scientists need structured, filterable, comparable data.

### Method
AI extraction via Claude Haiku 4.5 subagents. 20 concurrent agents, 5 trials per agent. Each trial's raw `eligibility_criteria` text is processed into:

- **Top-level booleans:** pregnancy_excluded, cns_excluded, hiv/hbv/hcv_excluded, autoimmune_excluded, requires_measurable_disease, accepts_healthy_volunteers
- **Top-level numerics:** min_age, max_age, ecog_min, ecog_max, life_expectancy_weeks
- **Individual criteria array:** each criterion has text, type (inclusion/exclusion), category, semantic_group, and optional structured_value (key-value pairs extracted from the text)

### Output
One CT_TRIAL_ELIGIBILITY document per trial. 4,118 extracted, 38 pending.

### Staleness Detection
`source_hash = md5(eligibility_criteria)` stored at extraction time. Dashboard compares stored hash against current trial text — if the source text changed (e.g., trial updated on CT.gov), the extraction is flagged as stale.

### Applied When
Write-time — extraction results are stored as documents. Changing the extraction model or prompts requires re-running extraction.

### Update Mechanics
Manual one-shot process. No automated re-extraction pipeline exists. Source hash tracking enables detecting which extractions need re-running.

---

## Pipeline 2: Category Normalization (Stem-Based Dedup)

### Problem
AI extraction produced ~4,349 unique category strings with many duplicates differing only in casing, pluralization, or phrasing (e.g., `prior_treatment` vs `PRIOR_THERAPY` vs `treatment_history`).

### Method
1. Split each category at underscores into stems
2. Compute pairwise Jaccard similarity between stem sets
3. Collapse 1.0-similarity bands (identical stem sets)
4. Human-reviewed merge/keep recommendations for 0.5–0.99 bands
5. No union-find (avoided mega-cluster chaining problem)

### Result
4,349 raw → 3,346 canonical categories (23% reduction).

### Storage
3,406 CT_ELIG_CATEGORY_MAPPING documents. Identity: `raw_category`. Maps to `canonical_category` + `semantic_group`.

### Seed Data
`elig_category_mappings.csv` (3,406 rows) — loaded at bootstrap.

### Applied When
Write-time — the mapping is baked into extraction output. Changing mappings requires re-extraction.

---

## Pipeline 3: Semantic Grouping

### Problem
3,346 canonical categories are still too many for meaningful UI navigation. Need higher-level clinical grouping.

### Method
Manual assignment into 43 semantic groups based on clinical domain knowledge, with iterative user corrections.

### The 43 Groups

PRIOR_TREATMENT, DIAGNOSIS, LAB_VALUES, INFECTION, CARDIAC, PREGNANCY_CONTRACEPTION, CONCOMITANT_MEDS, PERFORMANCE_STATUS, CNS, SURGERY, ALLERGY, CONSENT, STUDY_LOGISTICS, BIOMARKER, DISEASE_STAGING, AUTOIMMUNE, COMORBIDITY, PSYCHIATRIC, NEUROLOGY, RESPIRATORY, REPRODUCTIVE, RENAL, GASTROINTESTINAL, OPHTHALMOLOGY, HEPATIC, HEMATOLOGY, COAGULATION, METABOLIC, DERMATOLOGY, MUSCULOSKELETAL, TRANSPLANT, ENDOCRINE, NUTRITION, GENETICS, IMAGING, VITAL_SIGNS, SUBSTANCE_USE, VACCINATION, WEIGHT, PAIN, WOUND, DENTAL, SOCIAL

**Coverage:** 86% of 67k criteria entries. Remaining 14% are UNCLASSIFIED.

### Ontology
Groups are organized into a 2-level hierarchy using term relations (part_of). CT_SEMANTIC_GROUP terminology: 149 terms, 106 part_of relations. Used in the Population Explorer for hierarchical criteria navigation.

### Storage
Semantic group assignments are merged into CT_ELIG_CATEGORY_MAPPING documents (the same docs as Pipeline 2).

### Seed Data
`elig_semantic_group_mappings.csv` (157 rows) + CT_SEMANTIC_GROUP terminology with ontology relations.

### Applied When
Write-time (embedded in extraction output) and query-time (criteria browser uses the mapping for grouping).

---

## Pipeline 4: Structured Value Key Consolidation

### Problem
Within each semantic group, AI extraction produced structured_value objects with inconsistent keys (e.g., `test` vs `lab_test` vs `parameter` all meaning the same thing within LAB_VALUES).

### Method
91 rules mapping variant keys to canonical keys within each semantic group. Also includes lab unit normalization and boolean value cleanup.

### Examples
| Semantic Group | Source Key | Canonical Key |
|----------------|-----------|--------------|
| LAB_VALUES | test, parameter, lab, lab_name | lab_test |
| LAB_VALUES | unit, units | unit |
| PRIOR_TREATMENT | washout, washout_time | washout_period |
| CARDIAC | measurement, test | cardiac_test |

### Storage
692 CT_ELIG_SV_KEY_MAPPING documents. Identity: `semantic_group` + `source_key`.

### Seed Data
`elig_sv_key_mappings.csv` (692 rows).

### Applied When
Write-time — applied during extraction post-processing.

---

## Pipeline 5: Visit/Timepoint Normalization

### Problem
SAMI uses ~10,500 unique clinical event label strings (e.g., "W1", "CYCLE 1 DAY 1", "SCREENING", "W12PB", "END OF TREATMENT"). Scientists need to compare samples across studies by visit type and chronological position.

### Method
Regex-based normalization producing three fields per event:

1. **Phase** — canonical visit phase (10 values): SCREENING, BASELINE, PRE_TREATMENT, ON_TREATMENT, CYCLE_N, END_OF_TREATMENT, FOLLOW_UP, POST_TREATMENT, ARCHIVAL, UNSCHEDULED, NOT_SPECIFIED
2. **Anchor** — reference point for time calculation: BASELINE, SCREENING, CYCLE_1, CYCLE_2, ..., CYCLE_N
3. **Seconds from anchor** — integer seconds from the anchor point

### Design Decisions
- Non-oncology trials anchor to BASELINE
- Oncology trials with chemotherapy cycles anchor to CYCLE_N (cycles restart the clock)
- Seconds allow sub-day precision (important for PK sampling)
- UI displays as days or weeks
- Seconds are optional — some events (UNSCHEDULED, ARCHIVAL) have no meaningful time position

### Coverage
96% of 10,500 raw events mapped via mechanical regex rules.

### Storage
10,499 CT_CLINICAL_EVENT_MAPPING documents. Identity: `raw_event`. Maps to `phase` (term), `anchor`, `seconds_from_anchor`.

### Seed Data
`clinical_event_mappings.csv` (10,500 rows).

### Applied When
**Query-time** via LEFT JOIN:
```sql
LEFT JOIN doc_ct_clinical_event_mapping m ON m.raw_event = s.clinical_event
```

This means updating the mapping table takes effect immediately without re-importing SAMI data.

---

## Pipeline 6: Therapeutic Area Classification

### Problem
ClinicalTrials.gov provides "conditions" (disease names) but no therapeutic area classification. Roche needs trials grouped by TA.

### Method
Two-layer enrichment:

**Layer 1: Rule-Based Classification**
User-editable rules stored as CT_CLASSIFICATION_RULE documents:
- Pattern matching on trial conditions/interventions → target TA
- Match types: exact, contains, word boundary, regex
- Actions: add or remove
- Priority-ordered with per-trial overrides

**Layer 2: Ontology Ancestor Walk**
CT_THERAPEUTIC_AREA terminology has an `is_a` hierarchy (80 relations). When a trial matches a leaf TA (e.g., "Breast Cancer"), ancestors are added automatically (e.g., "Oncology").

**Pinning:** Users can manually pin a trial's TA assignment, which prevents automatic enrichment from overriding it.

### Applied When
**Query-time (client-side)** — runs in the browser on every page load via `enrichTherapeuticAreas()`. Rules and ontology are loaded once and applied to all ~4,100 trials in a useMemo.

### Update Mechanics
Instant — changing a rule or the ontology hierarchy takes effect on the next page load.

---

## Curation Workflow: Study Crosswalk

### Problem
Linking Roche study numbers (TA Portal) to NCT IDs (ClinicalTrials.gov) requires matching across systems with different identifiers.

### Three-Tier Matching
1. **ID-based:** Direct study number match → 746 linked
2. **Acronym match:** Study name vs CT.gov acronym → 84 linked
3. **Fuzzy matching:** Multi-signal scoring → 789 high / 1,825 medium / 253 low confidence

### Curation UI
- Two-panel triage: candidate list + side-by-side comparison
- Confidence badges and match signals (title similarity, compound match, phase match)
- Approve/reject/skip with keyboard shortcuts (A/R/S)
- Bulk approve for high-confidence matches
- On approval: patches CT_TA_STUDY.nct_id for direct JOIN

### Status
~2,900 fuzzy match candidates still need human review.

---

## Summary: Application Timing

| Pipeline | Applied At | Update Effect |
|----------|-----------|---------------|
| Eligibility extraction | Write-time | Requires re-extraction |
| Category dedup | Write-time | Requires re-extraction |
| Semantic grouping | Write-time + query-time | Extraction needs re-run; criteria browser uses mapping live |
| SV key consolidation | Write-time | Requires re-extraction |
| Visit/timepoint | **Query-time** (SQL JOIN) | Immediate — update mapping, query picks it up |
| TA classification | **Query-time** (client-side) | Immediate — update rules/ontology, next page load applies |
| Study crosswalk | Write-time (on approve) | Per-study, one-time |

**Design tension:** Write-time normalization (eligibility) produces better query performance and simpler SQL but is expensive to update. Query-time normalization (visit, TA) is flexible but adds JOIN overhead and client-side computation.
