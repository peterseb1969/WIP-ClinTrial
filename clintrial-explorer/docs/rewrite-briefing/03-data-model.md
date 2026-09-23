# 3. Data Model

## Core Entities

### Clinical Trials (CT_TRIAL)

The central entity. One document per NCT ID.

| Field | Type | Notes |
|-------|------|-------|
| nct_id | string | **Identity.** ClinicalTrials.gov identifier (e.g., "NCT04761783") |
| org_study_id | string | Roche study number (e.g., "WO42369"). Cross-reference key to SAMI and TA Portal |
| title | string | Official title |
| brief_title | string | Short title |
| acronym | string | Study acronym |
| status | term | RECRUITING, COMPLETED, TERMINATED, etc. (14 values) |
| phases | term | PHASE1, PHASE2, PHASE3, etc. (6 values) |
| study_type | term | INTERVENTIONAL, OBSERVATIONAL, EXPANDED_ACCESS |
| sponsor | string | Lead sponsor name |
| conditions | string[] | Disease conditions studied |
| interventions | string[] | Drug/molecule names |
| therapeutic_areas | string[] | Assigned TAs (enriched by classification rules + ontology) |
| ta_pinned | boolean | Whether TA assignment is manually pinned |
| enrollment | integer | Total enrollment |
| eligibility_criteria | string | Raw eligibility text (free text, often 2–5 pages) |
| start_date / completion_date / primary_completion_date | date | Key dates |
| has_results | boolean | Whether results (AEs, outcomes) are posted |
| description | string | Brief summary |
| detailed_description | string | Full description |
| file_references_json | string | Linked PDF document IDs |

**Volume:** 4,155 documents.

### Trial Results

Four sub-entity types, all keyed by `nct_id`:

| Entity | Identity | Volume | What It Captures |
|--------|----------|--------|------------------|
| CT_TRIAL_AE | nct_id + ae_category + term | 94,778 | Adverse events: term, organ system, source vocabulary, group-level stats (JSON) |
| CT_TRIAL_OUTCOME | nct_id + outcome_type + sequence | 38,096 | Primary/secondary outcomes: measure, time frame, description, result groups, analyses |
| CT_TRIAL_SITE | nct_id + facility + country | 25,791 | Trial sites: facility name, city, state, country (ISO), site status |
| CT_TRIAL_BASELINE | nct_id + measure_title | 3,097 | Baseline characteristics: parameter type, dispersion, units, categories |

### Eligibility (CT_TRIAL_ELIGIBILITY)

AI-extracted structured eligibility criteria. One per trial × extraction model.

| Field | Type | Notes |
|-------|------|-------|
| nct_id | string | **Identity** |
| extraction_model | string | **Identity.** Model version used (e.g., "haiku-4.5") |
| min_age / max_age | integer | Age range in years |
| ecog_min / ecog_max | integer | ECOG performance status range |
| pregnancy_excluded | boolean | |
| cns_excluded | boolean | CNS metastases excluded |
| autoimmune_excluded | boolean | |
| hiv_excluded / hbv_excluded / hcv_excluded | boolean | Viral exclusions |
| requires_measurable_disease | boolean | |
| life_expectancy_weeks | integer | Minimum life expectancy |
| accepts_healthy_volunteers | boolean | |
| criteria_json | string | JSON array of individual criteria (FTS-indexed) |
| criteria | array of CT_CRITERION | Same data as native array (enables SQL via jsonb_array_elements) |
| extracted_at | date | When extraction ran |
| source_hash | string | MD5 of source eligibility text at extraction time (staleness detection) |

**Nested: CT_CRITERION** (array item template):

| Field | Type | Notes |
|-------|------|-------|
| text | string | Original criterion text |
| criterion_type | string | "inclusion" or "exclusion" |
| category | string | Normalized category (e.g., "prior_treatment") |
| semantic_group | string | Higher-level group (e.g., "PRIOR_TREATMENT") |

**Volume:** 4,118 extractions covering 4,155 trials (38 pending).

### Sample Inventory (CT_SAMI_STUDY_DETAIL)

Per-timepoint sample data from the SAMI biobank.

| Field | Type | Notes |
|-------|------|-------|
| study_number | string | **Identity.** Roche study number |
| source_system | string | **Identity.** Always "SAMI" |
| sample_type | string | **Identity.** E.g., "Plasma", "Serum", "DNA" |
| clinical_event | string | **Identity.** Raw timepoint label (e.g., "W1", "SCREENING") |
| total_count / available / disposed / allocated / on_hold / in_circulation / marked_for_disposal | integer | Counts |
| unique_participants | integer | |
| earliest_collection / latest_collection | date | |
| use_pk / use_biomarker / use_protein / use_genomics / use_pd / use_ada / use_other | integer | Usage counts |
| snapshot_date | date | When SAMI export was taken |

**Volume:** 48,975 rows. Legacy summary table (CT_SAMI_STUDY_SUMMARY) has 9,106 rows at study × sample_type granularity.

### TA Portal Studies (CT_TA_STUDY)

Roche-internal study metadata.

| Field | Type | Notes |
|-------|------|-------|
| study_number | string | **Identity.** Roche study number |
| study_name | string | |
| therapeutic_area / disease_area / indication | term | TA Portal-specific terminologies |
| theme_molecule / non_lead_molecule | string | |
| phases | term | TA Portal phase classification |
| status / stage / study_type | term | |
| enrollment_planned / enrolled / completed | integer | |
| protocol_approval_date through clinical_closure_date | date | ~8 milestone dates |
| mgmt_model / sponsor_type / accountable_party / executing_party | term | Organizational metadata |
| nct_id | string | Added when crosswalk curation links to CT.gov |

**Volume:** 5,554 studies.

### Organizations (CT_ORGANIZATION)

| Field | Type | Notes |
|-------|------|-------|
| org_name | string | **Identity** |
| org_type | string | Sponsor, collaborator |
| country | string | |

**Volume:** 1,203 organizations.

---

## Normalization Mappings

| Entity | Identity | Volume | Purpose |
|--------|----------|--------|---------|
| CT_ELIG_CATEGORY_MAPPING | raw_category | 3,406 | Raw AI category → canonical category + semantic group |
| CT_ELIG_SV_KEY_MAPPING | semantic_group + source_key | 692 | Structured value key consolidation within semantic groups |
| CT_CLINICAL_EVENT_MAPPING | raw_event | 10,499 | Raw SAMI event string → phase + anchor + seconds_from_anchor |

---

## Controlled Vocabularies (Terminologies)

### Core Domain

| Terminology | Terms | Extensible | Examples |
|-------------|-------|------------|---------|
| CT_STATUS | 14 | no | RECRUITING, COMPLETED, TERMINATED, WITHDRAWN |
| CT_PHASE | 6 | no | PHASE1, PHASE2, PHASE3, PHASE4, NA, EARLY_PHASE1 |
| CT_STUDY_TYPE | 3 | no | INTERVENTIONAL, OBSERVATIONAL, EXPANDED_ACCESS |
| CT_THERAPEUTIC_AREA | 43 | yes | ONCOLOGY, IMMUNOLOGY, NEUROSCIENCE, OPHTHALMOLOGY |
| CT_MOLECULE | 2,142 | yes | Atezolizumab, Bevacizumab, Trastuzumab... |
| CT_TARGET | 30 | no | PD-L1, HER2, VEGF, CD20 |
| CT_DRUG_CLASS | 22 | no | Monoclonal antibody, kinase inhibitor |
| CT_OUTCOME_TYPE | 3 | no | PRIMARY, SECONDARY, OTHER |
| CT_AE_TERM | 0 (mutable) | yes | AE terms added at import time |
| COUNTRY | 251 | yes | ISO country codes with name aliases |

### Eligibility / Normalization

| Terminology | Terms | Has Ontology | Notes |
|-------------|-------|-------------|-------|
| CT_ELIGIBILITY_CATEGORY | 32 | no | AI extraction categories |
| CT_SEMANTIC_GROUP | 149 | yes (106 part_of, 80 is_a) | 43 top-level groups + subcategories |
| CT_VISIT_PHASE | 10 | no | SCREENING, BASELINE, ON_TREATMENT, CYCLE_N, EOT, FOLLOW_UP, etc. |

### TA Portal (12 terminologies)

CT_TA_THERAPEUTIC_AREA (8), CT_TA_DISEASE_AREA (60), CT_TA_STUDY_PHASE (14), CT_TA_STUDY_STATUS (10), CT_TA_STUDY_STAGE (8), CT_TA_STUDY_TYPE (11), CT_TA_MGMT_MODEL (4), CT_TA_SPONSOR_TYPE (12), CT_TA_ACCOUNTABLE_PARTY (9), CT_TA_EXECUTING_PARTY (20), CT_TA_PRODUCT_TYPE (4), CT_TA_PRODUCT_ROLE (7).

### Classification Rules

CT_RULE_TYPE (1), CT_MATCH_TYPE (4: exact, contains, regex, prefix), CT_RULE_ACTION (2: assign, override).

---

## Ontology / Term Relations

| Relation | Terminology | Count | Purpose |
|----------|-------------|-------|---------|
| is_a | CT_THERAPEUTIC_AREA | 80 | TA hierarchy (e.g., "Breast Cancer" is_a "Oncology") |
| part_of | CT_SEMANTIC_GROUP | 106 | Eligibility group hierarchy (subcategories → parent groups) |

---

## Cross-Entity Relationships

All relationships are query-time JOINs on shared keys:

```
CT_TRIAL (nct_id)
  ├── CT_TRIAL_AE (nct_id)
  ├── CT_TRIAL_OUTCOME (nct_id)
  ├── CT_TRIAL_SITE (nct_id)
  ├── CT_TRIAL_BASELINE (nct_id)
  ├── CT_TRIAL_ELIGIBILITY (nct_id)
  └── via org_study_id:
      ├── CT_SAMI_STUDY_DETAIL (study_number)
      │   └── CT_CLINICAL_EVENT_MAPPING (raw_event ← clinical_event)
      └── CT_TA_STUDY (study_number)

CT_TRIAL_ELIGIBILITY.criteria[].category
  └── CT_ELIG_CATEGORY_MAPPING (raw_category)
```

No pre-materialized edges exist between the main entities. The only edge type defined (CT_TA_STUDY_PRODUCT, linking studies to products) is unpopulated.

---

## Configuration & State Entities

| Entity | Identity | Volume | Purpose |
|--------|----------|--------|---------|
| CT_SETTINGS | settings_key | 1 | App settings (auto-sync toggle/interval) |
| CT_SYNC_STATE | sync_key | 1 | Import state (per-trial last-update timestamps) |
| CT_CLASSIFICATION_RULE | rule_type + pattern + target_ta | 0* | TA classification rules (*rules exist in code but not as documents) |
| CLINTRIAL_BOOTSTRAP_RECORD | bootstrap_id | 1 | Bootstrap audit trail |
