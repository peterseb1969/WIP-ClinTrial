# Known Issues

## 1. Therapeutic areas not populated on trials

**Status:** Open — deferred from initial build
**Impact:** The "therapeutic_areas" field on CT_TRIAL documents is empty for all but 1 of ~2,600 trials. The Dashboard shows "Top Conditions" as a workaround.

**Root cause:** The import script (`scripts/import_trials.py`, line 543) intentionally skips `therapeutic_areas` with the comment: "requires curated mapping, not raw conditions." ClinicalTrials.gov does not provide a structured therapeutic area field — only free-text `conditions` like "Breast Neoplasms", "Non-Small Cell Lung Cancer", etc.

**The data model is ready:** The `CT_THERAPEUTIC_AREA` terminology has 37 curated terms with well-structured aliases designed for keyword matching:

| Term | Aliases |
|------|---------|
| LUNG_CANCER | NSCLC, SCLC, Non-Small Cell Lung Cancer, Small Cell Lung Cancer |
| BREAST_CANCER | TNBC, Triple-Negative Breast Cancer, HER2+ Breast Cancer |
| LYMPHOMA | Non-Hodgkin's Lymphoma, NHL, Hodgkin Lymphoma, DLBCL |
| MULTIPLE_SCLEROSIS | MS, Relapsing MS, RMS |
| LEUKEMIA | AML, CLL, ALL, Acute Myeloid Leukemia |
| ... | (37 terms total, all with aliases) |

**Proposed fix:** Add a classification step to the import script that maps each trial's `conditions` array to matching `CT_THERAPEUTIC_AREA` terms using case-insensitive substring matching against term values, labels, and aliases. A trial can match multiple areas (e.g., a breast cancer + immunotherapy trial matches both BREAST_CANCER and ONCOLOGY).

**Implementation notes:**
1. Build a lookup table from the 37 terms: `{ keywords: [value, label, ...aliases], term_value: "LUNG_CANCER" }`
2. For each trial, scan its `conditions` array against all keyword sets
3. Assign matched term values to `therapeutic_areas` field
4. Trials with no match get no therapeutic area (don't force — better empty than wrong)
5. Re-import with `--full` flag to update existing trials (WIP's identity-based upsert handles this)
6. Consider: should the classifier also check `title` and `brief_summary` for keywords? Conditions alone may miss some (e.g., a COVID trial might list "Pneumonia" as the condition)

**Once populated:**
- Replace the Dashboard "Top Conditions" chart with "Top Therapeutic Areas" (the original design)
- Re-enable the `therapeutic_area` filter on the Trials page (currently works but matches nothing)
- The Molecules page could group by therapeutic area

## 2. Trial detail tabs slow for trials with many AEs

**Status:** Mostly fixed — switched to server-side SQL queries
**Residual:** For trials with 1000+ AE records, the `data_json` parsing in the browser can take a moment. Consider paginating the AE tab or fetching only aggregate counts initially.

## 3. File downloads untested

**Status:** Open
**Impact:** The Documents tab on trial detail has download buttons that call `client.files.getDownloadUrl()`. This path hasn't been tested end-to-end since only 202 files exist and the download URL generation depends on MinIO pre-signed URL configuration.
