# Clinical Trials Explorer — Rewrite Briefing

This folder captures the domain knowledge, data model, features, and design lessons from the current Clinical Trials Explorer app. It is written for a greenfield redesign — independent of the current codebase, technology stack, or architecture.

## Reading Order

| # | Document | What It Covers |
|---|----------|----------------|
| 1 | [Domain Context](01-domain-context.md) | What the app is, who uses it, the business problem |
| 2 | [Data Sources](02-data-sources.md) | Three data sources, what each provides, import mechanics, linking |
| 3 | [Data Model](03-data-model.md) | All entity types, relationships, terminologies, volumes |
| 4 | [Normalization & Curation](04-normalization-curation.md) | Six normalization pipelines, curation workflows, mapping rules |
| 5 | [User Features](05-user-features.md) | Every page, user workflow, and interaction |
| 6 | [Architecture & Patterns](06-architecture-patterns.md) | Query strategy, auth, bootstrap, import pipeline, sync |
| 7 | [Design Decisions & Lessons](07-design-decisions.md) | What worked, what didn't, tradeoffs encountered |
| 8 | [Open Questions for Rewrite](08-open-questions.md) | Known gaps, unfinished work, design questions to revisit |
| 9 | [Roche Ontology Service](09-roche-ontology-service.md) | Internal RTS API — 39 terminologies, 5,869 indications, potential canonical vocabulary source |
| 10 | [Timepoint Normalization Rules](10-timepoint-normalization-rules.md) | 19 regex patterns, seconds formulas, anchor rules — reproducible from this doc |

## Scope

- **~250,000 documents** across 20 templates
- **3 data sources**: ClinicalTrials.gov (API), SAMI biobank (CSV), TA Portal (CSV)
- **~4,200 clinical trials** with results, sites, AEs, eligibility, samples
- **6 normalization pipelines** (eligibility extraction, category dedup, semantic grouping, SV key consolidation, visit/timepoint, TA classification)
- **12 user-facing pages** plus admin import and bootstrap

## Generated

2026-09-04, from the live `clintrial` namespace and current codebase.
