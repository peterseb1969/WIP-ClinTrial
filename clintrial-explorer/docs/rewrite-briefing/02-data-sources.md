# 2. Data Sources

## Overview

| Source | Type | Records | Import Method | Refresh Cadence |
|--------|------|---------|---------------|-----------------|
| ClinicalTrials.gov | REST API | ~4,200 trials + results | Automated (incremental or full) | On-demand or scheduled (configurable, e.g. every 4h) |
| SAMI Biobank | CSV export | ~49,000 detail rows | Manual file upload | Periodic (when new export available) |
| TA Portal | CSV export | ~5,500 studies | Manual file upload | Periodic |

---

## Source 1: ClinicalTrials.gov

### What It Provides

The primary and richest data source. Provides:

- **Trial metadata:** NCT ID, title, status, phase, study type, sponsor, conditions, interventions (molecules), enrollment, dates, description, eligibility criteria (free text)
- **Results** (for completed trials with posted results):
  - Adverse events: term, organ system, frequency by study group, severity
  - Outcomes: primary/secondary measures, time frames, statistical analyses
  - Baseline characteristics: demographics, disease characteristics
- **Sites:** facility name, city, state, country, site-level status
- **Documents:** protocol PDFs, statistical analysis plans

### API

ClinicalTrials.gov API v2 (`https://clinicaltrials.gov/api/v2`). REST, JSON, paginated. No API key required but subject to rate limiting.

### Scope

Trials are filtered by sponsor: `Hoffmann-La Roche` or `Genentech, Inc.` This is configurable.

### Import Pipeline

Multi-phase pipeline with SSE-streamed progress:

1. **Fetch** — paginated sponsor search, collect all matching trial JSON
2. **Organizations** — extract unique sponsors/collaborators → CT_ORGANIZATION
3. **Terminologies** — ensure country codes, molecule names exist as terms (extensible terminologies — new values created on the fly)
4. **Trials** — transform CT.gov JSON to structured documents → CT_TRIAL (batches of 100)
5. **Outcomes** — per-trial outcome measures → CT_TRIAL_OUTCOME
6. **Sites** — per-trial locations → CT_TRIAL_SITE (country name → ISO code via COUNTRY terminology aliases)
7. **Results** — for trials with `has_results`: AEs → CT_TRIAL_AE, baselines → CT_TRIAL_BASELINE
8. **PDFs** — download and upload protocol documents → WIP file storage, linked to trial

### Incremental Sync

Each trial's `lastUpdatePostDate` is tracked in a sync-state document. Incremental imports skip trials whose update date hasn't changed since the last sync. This reduces a full import (~4,200 trials, ~30 min) to a typical incremental (~50–200 changed trials, ~5 min).

### Key Transformations

- Country names → ISO codes via terminology alias lookup
- Molecule names → canonical terms (handling brand/generic/abbreviation variants)
- Phase strings → normalized enum values
- Date field extraction from various CT.gov formats
- Enrollment numbers from multiple possible fields
- Therapeutic area assignment (see normalization doc)

---

## Source 2: SAMI Biobank Repository

### What It Provides

Sample inventory data from Roche's biobank. Each row represents a unique combination of study × sample type × clinical event (timepoint), providing:

- **Counts:** total, available, disposed, allocated, on hold, in circulation, marked for disposal
- **Usage breakdown:** samples used for PK, biomarker, protein, genomics, PD, ADA, other
- **Participant count:** unique participants contributing samples
- **Collection dates:** earliest and latest collection
- **Snapshot date:** when the inventory was exported

### Format

CSV export from the SAMI system. No API integration — manual file upload.

### Sample Types

Plasma, serum, whole blood, DNA, RNA, tissue (FFPE/fresh-frozen), urine, CSF, and others. Types are study-specific strings, not normalized to a controlled vocabulary.

### Linking to Trials

SAMI uses Roche study numbers (e.g., "WO42369"). ClinicalTrials.gov trials have an `org_study_id` field, but this field captures whatever the sponsor registered — not always a Roche study number. Of 4,155 CT.gov trials:

- **2,320** have a Roche-format study number (2 uppercase letters + digits, e.g., "WO42369", "ML21283")
- **1,835** have non-Roche identifiers (academic protocol numbers, external IDs like "ACTG 047", "0507-08 IUCRO-0130") — these cannot match SAMI or TA Portal by ID

The link is a query-time JOIN:

```
doc_ct_trial.org_study_id = doc_ct_sami_study_detail.study_number
```

However, the overlap is partial in the other direction — most SAMI studies are **not** on ClinicalTrials.gov:

| | Studies | Available Samples |
|---|---|---|
| Matched to CT.gov | 943 | 6,757,364 |
| **Not on CT.gov (orphans)** | **1,843** | **1,893,003** |
| Total SAMI studies | 2,786 | 8,650,367 |

66% of SAMI studies have no CT.gov match. These orphan studies carry ~1.9M available samples. The most common study number prefixes among orphans are DV (354), V- (263), RV (198), RE (195), BP (98), DC (88), RC (81), GO (61), C- (46). The meaning of these prefixes is unknown.

These studies have samples but no trial metadata (eligibility, AEs, outcomes, sites). A rewrite should decide whether to surface them — and if so, how, given the absence of clinical context.

### Visit/Timepoint Data

Each SAMI row has a `clinical_event` field — a study-specific label like "W1", "CYCLE 1 DAY 1", "SCREENING", "END OF TREATMENT". There are ~10,500 unique event strings across all studies. These are normalized via a mapping table (see normalization doc).

### Two Import Granularities

- **Summary** (legacy): study × sample_type. ~9,100 rows. Superseded but retained.
- **Detail** (current): study × sample_type × clinical_event. ~49,000 rows. Enables per-timepoint analysis.

---

## Source 3: TA Portal (Roche Internal Study Registry)

### What It Provides

Roche-internal study metadata not available on ClinicalTrials.gov:

- **Study identifiers:** study number, study name
- **Classification:** therapeutic area, disease area, indication, theme/molecule
- **Organizational:** accountable party, executing party, sponsor type, management model
- **Lifecycle dates:** protocol approval, site activation, first screening, first/last enrolled, last visit, DB lock, clinical closure
- **Status/phase/type:** Roche-internal classifications (different from CT.gov)

### Format

CSV export from the TA Portal system. Verbose column names are mapped to canonical field names at import time (e.g., "Study Management Model (Source: Veeva-CTMS)" → `mgmt_model`).

### Linking to ClinicalTrials.gov

The TA Portal uses Roche study numbers. Linking requires matching these to NCT IDs, which is non-trivial because:

- Not all TA Portal studies have a ClinicalTrials.gov equivalent
- The study number format may differ between systems
- Some studies have multiple CT.gov registrations

**Three-tier matching:**
1. **ID-based (exact):** Direct study number match → 746 linked
2. **Acronym match:** Study name vs CT.gov acronym → 84 linked
3. **Fuzzy matching:** Multi-signal scoring (title similarity, compound overlap, phase compatibility, indication match) → 789 high / 1,825 medium / 253 low confidence candidates

Fuzzy match candidates require human curation (approve/reject/skip) via a dedicated UI.

### TA Portal Terminologies

The TA Portal uses its own controlled vocabularies (12 terminologies), distinct from ClinicalTrials.gov's. These include therapeutic area, disease area, study phase, study status, study type, management model, sponsor type, and others.

---

## Cross-Source Relationships

```
ClinicalTrials.gov ←——— org_study_id / nct_id ———→ TA Portal
        ↑                                               
   org_study_id = study_number                         
        ↓                                              
      SAMI Biobank                                     
```

**Join keys:**
- CT_TRIAL.`org_study_id` ↔ CT_SAMI_STUDY_DETAIL.`study_number`
- CT_TRIAL.`nct_id` ↔ CT_TRIAL_ELIGIBILITY.`nct_id`
- CT_TRIAL.`nct_id` ↔ CT_TRIAL_AE/OUTCOME/SITE/BASELINE.`nct_id`
- CT_TRIAL.`org_study_id` ↔ CT_TA_STUDY.`study_number` (or via crosswalk edge after curation)
- CT_SAMI_STUDY_DETAIL.`clinical_event` ↔ CT_CLINICAL_EVENT_MAPPING.`raw_event` (normalization JOIN)

All cross-source links are query-time JOINs on shared keys — no pre-materialized edges (except the optional CT_STUDY_CROSSWALK created during curation).

**Date range overlap:**

| Source | Time Range | Studies |
|--------|-----------|---------|
| ClinicalTrials.gov | 1985–2026 (start dates) | 4,155 |
| TA Portal | 2006–2027 (protocol approval) | 5,554 |
| SAMI | no date filtering | 2,786 distinct studies |

CT.gov has 549 pre-2006 trials that fall outside TA Portal coverage entirely. Cross-source overlap varies dramatically by era:

| Period | CT.gov trials | With Roche ID | TA Portal match | TA % of Roche | SAMI match | SAMI % of total |
|--------|--------------|---------------|-----------------|---------------|------------|-----------------|
| 2006–2010 | 1,230 | 570 | 3 | 1% | 143 | 12% |
| 2011–2015 | 1,029 | 785 | 64 | 8% | 314 | 31% |
| 2016–2020 | 639 | 429 | 238 | 55% | 284 | 44% |
| 2021–2026 | 603 | 337 | 330 | 98% | 155 | 26% |

Key observations:
- **TA Portal** is essentially a recent system — near-complete coverage for 2021+ trials (98%), but drops off sharply for older studies
- **SAMI** peaks at 2016–2020 (44%) — those trials had time to collect samples but aren't so old the samples are depleted. The 2021+ dip (26%) reflects newer trials that haven't accumulated samples yet
- **Roche-format IDs** are a shrinking share of CT.gov trials over time (76% in 2011–2015 vs 56% in 2021–2026) — academic and externally-led trials are a growing portion
