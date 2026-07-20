# Learnings

Observations and lessons learned during development, useful for future sessions and similar projects.

## 1. Ambiguous abbreviations in terminology aliases

**Date:** 2026-03-26
**Context:** The CT_THERAPEUTIC_AREA terminology had "CRC" as an alias for COLORECTAL_CANCER.

**What happened:** Trial NCT05660850 studies Chronic Refractory Cough (also abbreviated CRC). The classifier matched "CRC" in the condition text and incorrectly tagged the trial as COLORECTAL_CANCER. The UI then showed "Chronic Obstructive Pulmonary Disease" under the Colorectal Cancer therapeutic area.

**Root cause:** Short medical abbreviations are frequently overloaded. "CRC" means Colorectal Cancer in oncology but Chronic Refractory Cough in pulmonology. The keyword classifier can't disambiguate without context.

**Fix:** Removed "CRC" from the COLORECTAL_CANCER aliases. The longer forms ("Colorectal Cancer", "Colon Cancer", "Rectal Cancer") are unambiguous and sufficient. Corrected the misclassified trial.

**Lesson:** When curating terminology aliases, avoid abbreviations shorter than 4 characters unless they are truly unambiguous in the domain. The classifier already skips 1-2 character keywords and uses word-boundary matching for 3-4 character keywords, but even word-boundary matching can't resolve genuine polysemy. A future mapping rules UI (roadmap 3b) should surface which abbreviations are matching and allow users to flag ambiguous ones.

**Affected terms to audit:** Other potentially ambiguous short aliases in the data model:
- "AD" for ALZHEIMERS_DISEASE (also Atopic Dermatitis, Autosomal Dominant)
- "MS" for MULTIPLE_SCLEROSIS (also Mass Spectrometry, Morphine Sulfate)
- "IPF" — likely safe (Idiopathic Pulmonary Fibrosis is the dominant usage)
- "SMA" — likely safe (Spinal Muscular Atrophy is dominant in Roche context)
- "NHL" for LYMPHOMA (also National Hockey League, but unlikely in trial conditions)

## 2. Conditions are free text with massive duplication

**Date:** 2026-03-26
**Context:** ClinicalTrials.gov conditions are investigator-entered free text with no controlled vocabulary.

**What happened:** 79 distinct spellings for "lung cancer" variants: different casing ("Non-Small Cell" vs "Non-small Cell"), different punctuation ("Non-Small-Cell" vs "Non Small Cell"), abbreviations ("NSCLC"), inverted word order ("Carcinoma, Non-Small-Cell Lung"), qualifier prefixes ("Stage IV", "Metastatic", "Advanced"), British spellings ("Haemophilia" vs "Hemophilia"), and even Unicode variants (fullwidth comma).

**Fix (interim):** Display-time normalization that strips qualifiers, normalizes punctuation/casing/spelling, and groups by the canonical form while showing the most common spelling. This doesn't fix the underlying data.

**Fix (proper, on roadmap):** Create a CT_CONDITION terminology with curated canonical terms and aliases, resolve free-text conditions against it during import, and store resolved term values on trial documents. This is a data model change requiring Phase 2/3 process.

**Lesson:** Free-text fields from external sources should always be resolved against a controlled vocabulary at import time, not just stored verbatim. The cost of curation increases with every session that builds on uncurated data.

## 3. Reporting layer terms table is empty — SUPERSEDED

**Date:** 2026-03-26 · **Superseded:** 2026-07-20 (CASE-729)

**Original claim (now false):** queries against `terms` and `terminologies` return 0 rows, so term data must come from the def-store API.

**Current state, verified against the live install:** reporting-sync replicates term data. The `clintrial` reporting schema carries `terms` = 1,099 rows, `terminologies` = 13, `term_relations` = 80 (note the table is named `term_relations`, not `term_relationships`). SQL against these tables is a supported pattern — `useAETermResolution`, `ae-cleanup`, and `useClassificationRules` already rely on it. Do NOT "fix" those queries back to REST on the strength of the original claim.

**Lesson (still valid):** always verify which data the reporting layer carries against the *current* platform before assuming — in either direction. Claims about platform scope rot; date them and re-verify after platform upgrades.

## 4. WIP file upload works, but linking is a separate step

**Date:** 2026-03-26
**Context:** The original import script downloaded PDFs from ClinicalTrials.gov and uploaded them to WIP, but never linked them to trial documents.

**What happened:** 202 files were reported as uploaded, but the trial documents had empty `file_references`. The upload returned `file_id` values, but the script stored them in a local variable and never wrote them back to the trial document. A TODO comment at line 969 said "update trial document with file IDs once file linking is tested."

**Fix:** New script (`scripts/download_trial_docs.py`) that downloads, uploads, AND links files to trials via document upsert.

**Lesson:** WIP file fields are two-step: (1) upload file → get file_id, (2) include file_id in document data field. If step 2 is skipped, files become orphans. The `@wip/client` docs describe this pattern, but it's easy to defer step 2 "until later" and forget.

## 5. Server-side SQL via reporting layer is dramatically faster

**Date:** 2026-03-26
**Context:** Initial implementation fetched all data via the WIP document API with client-side pagination.

**What happened:** The Dashboard fetched 2,600 trial JSON blobs to compute chart data. The Sites page paginated through 25,000+ site documents. The AE tab on trial detail tried to paginate through 88,000+ AE records, causing infinite spinners.

**Fix:** Switched to the WIP reporting-sync SQL API (`/api/reporting-sync/query`). Dashboard runs 7 parallel SQL queries with GROUP BY. Sites page does one SQL with GROUP BY country. Trial detail tabs query by nct_id with indexed lookups.

**Lesson:** Use the document API for CRUD operations and the reporting SQL API for any read that involves aggregation, filtering across templates, or large result sets. The reporting layer exists precisely for this — don't try to replicate SQL aggregation in the browser.
