# WIP Dependencies

All entities are in the `clintrial` namespace unless noted.

## Terminologies

| Value | Label | Terms | Used For | Created By |
|-------|-------|-------|----------|------------|
| `CT_PHASE` | Study Phase | 6 | Trial phase badges, filter | Import script |
| `CT_STATUS` | Study Status | 14 | Trial status badges, filter | Import script |
| `CT_STUDY_TYPE` | Study Type | 3 | Trial detail chip | Import script |
| `CT_OUTCOME_TYPE` | Outcome Type | 3 | Outcome tab grouping | Import script |
| `CT_THERAPEUTIC_AREA` | Therapeutic Area | 37 | **Not yet populated** — see KNOWN_ISSUES.md | Import script (terms exist, not mapped to trials) |
| `CT_DRUG_CLASS` | Drug Class | 22 | Not used in UI yet | Import script |
| `CT_TARGET` | Molecular Targets | 30 | Not used in UI yet | Import script |
| `CT_MOLECULE` | Molecules | 34 | Trial interventions, Molecules page | Import script |
| `COUNTRY` (namespace: `wip`) | Countries | 50 | Site country codes, Sites page | Shared WIP terminology |

## Templates

### CT_TRIAL
- **Identity fields:** `nct_id`
- **Fields read by app:** nct_id, title, brief_title, acronym, status, phases, study_type, therapeutic_areas, brief_summary, enrollment, start_date, primary_completion_date, completion_date, sponsor, interventions, conditions, eligibility_criteria, minimum_age, maximum_age, sex, healthy_volunteers, has_results, ctgov_url
- **App writes:** None (read-only)
- **Reporting table:** `doc_ct_trial` (status column: `data_status`, arrays stored as JSON strings)

### CT_ORGANIZATION
- **Identity fields:** `org_name`
- **Fields read by app:** org_name, org_type (via sponsor reference on CT_TRIAL)
- **Reporting table:** `doc_ct_organization`

### CT_TRIAL_OUTCOME
- **Identity fields:** `nct_id`, `outcome_type`, `sequence`
- **Fields read by app:** nct_id, outcome_type, sequence, measure, time_frame, description, result_groups, analyses
- **Reference:** `trial` → CT_TRIAL (by nct_id)
- **Reporting table:** `doc_ct_trial_outcome`

### CT_TRIAL_SITE
- **Identity fields:** `nct_id`, `facility`, `country`
- **Fields read by app:** nct_id, facility, city, state, country, zip, site_status
- **Reference:** `trial` → CT_TRIAL (by nct_id)
- **Reporting table:** `doc_ct_trial_site`

### CT_TRIAL_AE
- **Identity fields:** `nct_id`, `ae_category`, `term`
- **Fields read by app:** nct_id, ae_category, term, organ_system, source_vocabulary, stats (array of group objects with num_affected, num_at_risk)
- **Reference:** `trial` → CT_TRIAL (by nct_id)
- **Reporting table:** `doc_ct_trial_ae`

### CT_TRIAL_BASELINE
- **Identity fields:** `nct_id`, `measure_title`
- **Fields read by app:** nct_id, measure_title, param_type, unit_of_measure, categories (array with measurements per group)
- **Reference:** `trial` → CT_TRIAL (by nct_id)
- **Reporting table:** `doc_ct_trial_baseline`

## Reporting SQL API

The app uses the WIP Reporting-Sync service (`/api/reporting-sync/query`) for most data fetching. This is a read-only SQL interface to PostgreSQL tables that mirror WIP documents.

Key queries:
- Dashboard: `GROUP BY` aggregations on `doc_ct_trial` with `jsonb_array_elements_text` for array fields
- Trial detail: `SELECT data_json FROM doc_ct_trial_* WHERE nct_id = $1`
- Sites: `GROUP BY country` on `doc_ct_trial_site`
- Country filter: `SELECT DISTINCT nct_id FROM doc_ct_trial_site WHERE country = $1`

## Seed Files

```
data-model/
├── terminologies/
│   ├── CT_PHASE.json
│   ├── CT_STATUS.json
│   ├── CT_STUDY_TYPE.json
│   ├── CT_OUTCOME_TYPE.json
│   ├── CT_THERAPEUTIC_AREA.json
│   ├── CT_DRUG_CLASS.json
│   ├── CT_TARGET.json
│   ├── CT_MOLECULE.json
│   └── COUNTRY.json
└── templates/
    ├── 01_CT_ORGANIZATION.json
    ├── 02_CT_TRIAL.json
    ├── 03_CT_TRIAL_OUTCOME.json
    ├── 04_CT_TRIAL_SITE.json
    ├── 05_CT_TRIAL_AE.json
    └── 06_CT_TRIAL_BASELINE.json
```

## External Data Sources

- **ClinicalTrials.gov API v2** (`https://clinicaltrials.gov/api/v2`) — Source of all trial data. Imported via `scripts/import_trials.py` with incremental sync support.
