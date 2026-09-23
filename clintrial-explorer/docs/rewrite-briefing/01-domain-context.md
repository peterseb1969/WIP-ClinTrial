# 1. Domain Context

## What This App Does

Clinical Trials Explorer is an internal Roche/Genentech tool that lets scientists browse, analyze, and cross-reference clinical trial data from multiple sources. Its primary audience is biobank scientists who need to find the best biological samples for their research projects.

## The Core Problem

Roche runs ~4,200 clinical trials tracked on ClinicalTrials.gov. A subset of these (~1,000) have associated biological samples stored in the SAMI biobank repository. Scientists need to:

1. **Find relevant trials** — by therapeutic area, molecule, condition, phase, status
2. **Understand study populations** — what patients were included/excluded (age, ECOG status, comorbidities, prior treatments)
3. **Locate available samples** — which trials have plasma, serum, DNA, etc., at which timepoints, in what quantities
4. **Compare trials** — side-by-side eligibility criteria, AE profiles, sample availability
5. **Cross-reference internal data** — link ClinicalTrials.gov records to Roche's internal TA Portal study metadata

## Users

| Role | Needs |
|------|-------|
| **Biobank scientist** | Find samples matching specific research requirements (indication, timepoint, sample type, population characteristics) |
| **Clinical researcher** | Explore trial portfolios by therapeutic area, compare molecule safety profiles |
| **Data curator** | Link studies across systems (CT.gov ↔ TA Portal), manage TA classifications, clean up AE terminology |
| **Admin** | Import new data, manage settings, run bootstrap |

## Data Volume

| Entity | Count | Source |
|--------|-------|--------|
| Clinical trials | 4,155 | ClinicalTrials.gov |
| Adverse event records | 94,778 | ClinicalTrials.gov (results) |
| Sample inventory rows | 48,975 | SAMI biobank |
| Trial outcomes | 38,096 | ClinicalTrials.gov (results) |
| Trial sites | 25,791 | ClinicalTrials.gov |
| TA Portal studies | 5,554 | Roche TA Portal |
| Eligibility extractions | 4,118 | AI pipeline (Haiku 4.5) |
| Normalization mappings | 14,597 | Curated pipelines |
| Organizations | 1,203 | ClinicalTrials.gov |
| **Total documents** | **~249,000** | |

## How It Grew

The app started as a single-source ClinicalTrials.gov browser (Phase 1–4 of the WIP development process). It then grew through iterative feature additions:

1. **Trials browser + dashboard** — core CT.gov data, filtering, charting
2. **Results integration** — AEs, outcomes, baselines, protocol PDFs
3. **TA classification** — rule-based + ontology-based therapeutic area assignment
4. **SAMI integration** — biobank sample inventory as a second data source
5. **TA Portal integration** — Roche internal study metadata as a third data source
6. **Study crosswalk** — fuzzy matching + curation UI to link CT.gov ↔ TA Portal
7. **Eligibility extraction** — AI pipeline to structure unstructured eligibility text
8. **Normalization** — category dedup, semantic grouping, SV key consolidation, visit/timepoint normalization
9. **Population Explorer** — sample-focused eligibility search with criteria browser

Each layer was added on top of the previous one, which is why a redesign is being considered.
