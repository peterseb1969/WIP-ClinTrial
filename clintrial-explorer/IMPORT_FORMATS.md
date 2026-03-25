# Import Formats

## ClinicalTrials.gov API v2

- **Source:** ClinicalTrials.gov (`https://clinicaltrials.gov/api/v2`)
- **Method:** Python script (`scripts/import_trials.py`)
- **Trigger:** Manual CLI execution (no UI trigger)
- **Format:** JSON API responses

### Import modes

| Flag | Behavior |
|------|----------|
| (none) | Incremental sync — only trials changed since last sync |
| `--full` | Full reimport — all trials, ignores sync state |
| `--since 2025-01-01` | Only trials updated after a date |
| `--limit 100` | Cap at 100 trials per sponsor (for testing) |

### Sponsors searched

- "Hoffmann-La Roche" — ~2,534 trials
- "Genentech, Inc." — ~1,617 trials
- Overlap deduplicated via WIP identity hashing on `nct_id`

### Field mapping (CT_TRIAL)

| ClinicalTrials.gov field | WIP field | Notes |
|--------------------------|-----------|-------|
| `protocolSection.identificationModule.nctId` | `nct_id` | Identity field |
| `protocolSection.identificationModule.officialTitle` | `title` | |
| `protocolSection.identificationModule.briefTitle` | `brief_title` | |
| `protocolSection.identificationModule.acronym` | `acronym` | |
| `protocolSection.statusModule.overallStatus` | `status` | Mapped to CT_STATUS term |
| `protocolSection.designModule.phases` | `phases` | Array, mapped to CT_PHASE terms |
| `protocolSection.designModule.studyType` | `study_type` | Mapped to CT_STUDY_TYPE term |
| `protocolSection.descriptionModule.briefSummary` | `brief_summary` | |
| `protocolSection.designModule.enrollmentInfo.count` | `enrollment` | |
| `protocolSection.statusModule.startDateStruct.date` | `start_date` | |
| `protocolSection.statusModule.primaryCompletionDateStruct.date` | `primary_completion_date` | |
| `protocolSection.statusModule.completionDateStruct.date` | `completion_date` | |
| `protocolSection.sponsorCollaboratorsModule.leadSponsor.name` | `sponsor` | Reference to CT_ORGANIZATION |
| `protocolSection.armsInterventionsModule.interventions` | `interventions` | Matched against CT_MOLECULE terms |
| `protocolSection.conditionsModule.conditions` | `conditions` | Free-text array |
| `protocolSection.eligibilityModule.eligibilityCriteria` | `eligibility_criteria` | |
| `hasResults` | `has_results` | Boolean |

### Molecule matching

The import script maintains a `KNOWN_MOLECULES` dictionary that maps intervention names (including brand names like "Herceptin", "Tecentriq") to canonical CT_MOLECULE term values. Unrecognized interventions are skipped.

### Related documents

For each trial, the script also imports:
- **CT_TRIAL_OUTCOME** — from `resultsSection.outcomeMeasuresModule`
- **CT_TRIAL_SITE** — from `protocolSection.contactsLocationsModule.locations`
- **CT_TRIAL_AE** — from `resultsSection.adverseEventsModule`
- **CT_TRIAL_BASELINE** — from `resultsSection.baselineCharacteristicsModule`

### Sync state

Stored in `data-model/sync-state.json` (git-ignored). Tracks last sync timestamp and per-trial change detection hashes for incremental sync.

### Known data gaps

- `therapeutic_areas` is not populated — see KNOWN_ISSUES.md #1
- `detailed_description` is not imported (would significantly increase document size)
- File/document attachments (PDFs) are imported for trials that have them (~202 files)
