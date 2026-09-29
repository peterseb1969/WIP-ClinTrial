# 11. ClinicalTrials.gov Field Reference

Complete field inventory from the CT.gov API v2, organized by module. 454 fields total across protocol and results sections. Fields marked with **[IMPORT]** are currently imported into the app. Fields marked with **[RECOMMENDED]** are not currently imported but would be valuable for sample identification use cases.

## Protocol Section

### Identification Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| nctId | nct | **[IMPORT]** | Primary identifier |
| orgStudyIdInfo.id | text | **[IMPORT]** | Roche study number (org_study_id) |
| orgStudyIdInfo.type | enum | No | FEDERAL, REGISTRY, OTHER, etc. |
| secondaryIdInfos[].id | text | No | **[RECOMMENDED]** Additional IDs (EudraCT, other registries). Could improve cross-source matching |
| secondaryIdInfos[].type | enum | No | **[RECOMMENDED]** ID type classification |
| briefTitle | text | **[IMPORT]** | |
| officialTitle | text | **[IMPORT]** | |
| acronym | text | **[IMPORT]** | |
| organization.fullName | text | **[IMPORT]** | Via sponsor field |
| organization.class | enum | No | INDUSTRY, NIH, FED, OTHER |

### Status Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| overallStatus | enum | **[IMPORT]** | RECRUITING, COMPLETED, etc. |
| whyStopped | markup | No | **[RECOMMENDED]** Reason for termination — relevant for understanding sample populations from terminated trials |
| startDateStruct.date | date | **[IMPORT]** | |
| primaryCompletionDateStruct.date | date | **[IMPORT]** | |
| completionDateStruct.date | date | **[IMPORT]** | |
| studyFirstPostDateStruct.date | date | No | When registered on CT.gov |
| resultsFirstPostDateStruct.date | date | No | When results were posted |
| lastUpdatePostDateStruct.date | date | **[IMPORT]** | Used for incremental sync |
| expandedAccessInfo.hasExpandedAccess | boolean | No | |

### Sponsor & Collaborators Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| leadSponsor.name | text | **[IMPORT]** | |
| leadSponsor.class | enum | No | INDUSTRY, NIH, etc. |
| collaborators[].name | text | **[IMPORT]** | Via CT_ORGANIZATION |
| collaborators[].class | enum | No | |
| responsibleParty.type | enum | No | SPONSOR, PRINCIPAL_INVESTIGATOR, SPONSOR_INVESTIGATOR |
| responsibleParty.investigatorFullName | text | No | |
| responsibleParty.investigatorAffiliation | text | No | |

### Oversight Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| oversightHasDmc | boolean | No | Has Data Monitoring Committee |
| isFdaRegulatedDrug | boolean | No | **[RECOMMENDED]** Indicates FDA regulation — relevant for sample regulatory status |
| isFdaRegulatedDevice | boolean | No | |
| fdaaa801Violation | boolean | No | |

### Description Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| briefSummary | markup | **[IMPORT]** | |
| detailedDescription | markup | **[IMPORT]** | |

### Conditions Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| conditions[] | text[] | **[IMPORT]** | Disease conditions |
| keywords[] | text[] | No | **[RECOMMENDED]** Sponsor-assigned keywords — often include sample-relevant terms (biomarker, PK, translational) |

### Design Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| studyType | enum | **[IMPORT]** | INTERVENTIONAL, OBSERVATIONAL, EXPANDED_ACCESS |
| phases[] | enum[] | **[IMPORT]** | |
| designInfo.allocation | enum | No | **[RECOMMENDED]** RANDOMIZED, NON_RANDOMIZED — affects sample population homogeneity |
| designInfo.interventionModel | enum | No | **[RECOMMENDED]** PARALLEL, CROSSOVER, SEQUENTIAL, SINGLE_GROUP, FACTORIAL — affects how samples from different arms compare |
| designInfo.primaryPurpose | enum | No | TREATMENT, PREVENTION, DIAGNOSTIC, BASIC_SCIENCE, etc. |
| designInfo.observationalModel | enum | No | COHORT, CASE_CONTROL, etc. (observational only) |
| designInfo.timePerspective | enum | No | PROSPECTIVE, RETROSPECTIVE, etc. (observational only) |
| designInfo.maskingInfo.masking | enum | No | NONE, SINGLE, DOUBLE, TRIPLE, QUADRUPLE |
| **bioSpec.retention** | **enum** | **No** | **[RECOMMENDED]** SAMPLES_WITH_DNA, SAMPLES_WITHOUT_DNA, NONE_RETAINED. **Directly indicates whether the trial retains biological specimens.** Only present on observational studies. |
| **bioSpec.description** | **markup** | **No** | **[RECOMMENDED]** Free-text description of biospecimen types collected (e.g., "Blood sample for DNA analysis"). |
| enrollmentInfo.count | integer | **[IMPORT]** | |
| enrollmentInfo.type | enum | No | ACTUAL vs ESTIMATED |
| patientRegistry | boolean | No | Observational study flag |
| targetDuration | time | No | Observational study duration |

### Arms & Interventions Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| armGroups[].label | text | No | Arm name |
| armGroups[].type | enum | No | **[RECOMMENDED]** EXPERIMENTAL, ACTIVE_COMPARATOR, PLACEBO_COMPARATOR, SHAM_COMPARATOR, NO_INTERVENTION — critical for understanding which arm's samples are from treated vs control patients |
| armGroups[].description | markup | No | **[RECOMMENDED]** Contains dosing schedule, cycle length, treatment duration. Source for cycle_length_days extraction (see doc 10). |
| armGroups[].interventionNames[] | text[] | No | |
| interventions[].type | enum | No | DRUG, BIOLOGICAL, DEVICE, PROCEDURE, RADIATION, etc. |
| interventions[].name | text | **[IMPORT]** | Via interventions/molecules |
| interventions[].description | markup | No | **[RECOMMENDED]** Contains dosing details, route, cycle info |
| interventions[].otherNames[] | text[] | No | **[RECOMMENDED]** Alternative drug names (RO numbers, generic names) — directly useful for molecule cross-referencing |

### Outcomes Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| primaryOutcomes[].measure | text | **[IMPORT]** | |
| primaryOutcomes[].description | markup | **[IMPORT]** | |
| primaryOutcomes[].timeFrame | text | **[IMPORT]** | **[RECOMMENDED]** Contains treatment duration info (e.g., "up to 2 years") |
| secondaryOutcomes[] | same | **[IMPORT]** | |

### Eligibility Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| eligibilityCriteria | markup | **[IMPORT]** | Raw text, fed to AI extraction |
| healthyVolunteers | boolean | **[IMPORT]** | Via extraction |
| sex | enum | No | ALL, FEMALE, MALE |
| genderBased | boolean | No | |
| minimumAge | time | **[IMPORT]** | Via extraction (normalized to years) |
| maximumAge | time | **[IMPORT]** | Via extraction |
| stdAges[] | enum[] | No | CHILD, ADULT, OLDER_ADULT |
| studyPopulation | markup | No | Observational only — description of the study population |
| samplingMethod | enum | No | PROBABILITY_SAMPLE, NON_PROBABILITY_SAMPLE |

### Contacts & Locations Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| locations[].facility | text | **[IMPORT]** | Via CT_TRIAL_SITE |
| locations[].city | text | **[IMPORT]** | |
| locations[].state | text | **[IMPORT]** | |
| locations[].country | text | **[IMPORT]** | |
| locations[].zip | text | **[IMPORT]** | |
| locations[].status | enum | **[IMPORT]** | Site-level status |
| locations[].geoPoint | geo | No | **[RECOMMENDED]** lat/lon — enables map-based site visualization without geocoding |
| overallOfficials[].name | text | No | |
| overallOfficials[].affiliation | text | No | |
| centralContacts[].name | text | No | |
| centralContacts[].email | text | No | |

### References Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| references[].pmid | text | No | **[RECOMMENDED]** PubMed IDs linked to the trial — enables literature cross-referencing |
| references[].type | enum | No | RESULT, DERIVED, BACKGROUND |
| references[].citation | text | No | |
| seeAlsoLinks[].url | text | No | |

### IPD Sharing Module

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| ipdSharing | enum | No | **[RECOMMENDED]** YES, NO, UNDECIDED — indicates whether individual patient data is available for sharing |
| ipdSharingDescription | markup | No | |
| ipdSharingInfoType[] | enum[] | No | STUDY_PROTOCOL, SAP, ICF, CSR, ANALYTIC_CODE |
| ipdSharingTimeFrame | markup | No | |
| ipdSharingAccessCriteria | markup | No | |

---

## Results Section (for trials with has_results = true)

### Participant Flow

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| groups[].title | text | No | Arm names in results |
| groups[].description | text | No | |
| periods[].milestones[].achievements[] | struct | No | **[RECOMMENDED]** Actual participant counts per arm per milestone (STARTED, COMPLETED, NOT_COMPLETED) — tells you how many patients contributed samples per arm |
| periods[].dropWithdraws[].reasons[] | struct | No | Dropout reasons and counts |

### Baseline Characteristics

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| measures[].title | text | **[IMPORT]** | Age, sex, race, etc. |
| measures[].paramType | enum | **[IMPORT]** | MEAN, MEDIAN, COUNT_OF_PARTICIPANTS, etc. |
| measures[].unitOfMeasure | text | **[IMPORT]** | |
| measures[].classes[].categories[].measurements[] | struct | **[IMPORT]** | Per-arm values |

### Outcome Measures

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| outcomeMeasures[] | struct | **[IMPORT]** | Full outcome data with statistical analyses |

### Adverse Events

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| eventGroups[] | struct | **[IMPORT]** | Per-arm AE group summaries |
| seriousEvents[] | struct | **[IMPORT]** | SAEs with MedDRA terms |
| otherEvents[] | struct | **[IMPORT]** | Other AEs |
| frequencyThreshold | number | No | Reporting threshold |
| timeFrame | text | No | AE collection period |
| eventGroups[].deathsNumAffected | integer | No | **[RECOMMENDED]** Deaths per arm |
| adverseEventsModule.description | text | No | Safety population definition |

---

## Derived Section (computed by CT.gov)

| Field | Type | Currently Imported | Notes |
|-------|------|-------------------|-------|
| conditionBrowseModule.meshes[] | struct | No | **[RECOMMENDED]** MeSH terms for conditions — standardized vocabulary, could replace/supplement free-text conditions |
| conditionBrowseModule.ancestors[] | struct | No | MeSH hierarchy |
| interventionBrowseModule.meshes[] | struct | No | **[RECOMMENDED]** MeSH terms for interventions — standardized drug/procedure names |
| interventionBrowseModule.ancestors[] | struct | No | MeSH hierarchy |

---

## Recommended Fields for Sample Identification

Prioritized by value for the use case of "find the right biobank samples for my research":

### High Priority (directly affects sample selection)

1. **bioSpec.retention + bioSpec.description** — Directly states whether the trial collects biospecimens and what kind. Only on observational studies, but when present it's the most direct signal.

2. **armGroups[].type** — EXPERIMENTAL vs ACTIVE_COMPARATOR vs PLACEBO_COMPARATOR. A scientist needs to know which arm the samples came from — treated vs control patients have fundamentally different profiles.

3. **armGroups[].description + interventions[].description** — Contains cycle length, dosing schedule, treatment duration. Already demonstrated as extractable for cycle_length_days (doc 10).

4. **interventions[].otherNames[]** — RO numbers, generic names, brand names. Direct input for molecule cross-referencing between CT.gov, SAMI, and TA Portal.

5. **designInfo.allocation + designInfo.interventionModel** — RANDOMIZED vs non-randomized, PARALLEL vs CROSSOVER. Affects sample comparability across arms.

6. **conditionBrowseModule.meshes[]** — MeSH-standardized conditions. Could replace/supplement the current free-text condition matching and TA classification rules.

### Medium Priority (improves search and filtering)

7. **secondaryIdInfos[]** — Additional registry IDs. Improves cross-source matching (especially EudraCT numbers for EU studies).

8. **keywords[]** — Sponsor-assigned keywords. Often include biomarker names, sample types, research focus areas not captured in conditions.

9. **participantFlow milestones** — Actual per-arm enrollment counts. Tells a scientist "this arm had 150 patients" vs "this arm had 20" — affects expected sample availability.

10. **ipdSharing** — Whether individual patient data is available. Relevant for researchers who need more than samples.

11. **references[].pmid** — PubMed links. Enables literature cross-referencing for study context.

12. **whyStopped** — Why a trial was terminated. Relevant context: a trial stopped for safety vs stopped for futility produces different sample populations.

### Lower Priority (nice to have)

13. **locations[].geoPoint** — lat/lon for map visualization (avoids geocoding).
14. **isFdaRegulatedDrug** — Regulatory context.
15. **interventionBrowseModule.meshes[]** — MeSH-standardized drug names.
16. **enrollmentInfo.type** — ACTUAL vs ESTIMATED.
