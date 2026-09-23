# 9. Roche Ontology Service (RTS)

## Overview

Roche operates an internal ontology service at `ontology-services.roche.com` (also referred to as RTS — Roche Terminology Service). It exposes curated, hierarchical terminologies via a REST/JSON-LD API with OAuth2 authentication (Roche PingFederate).

This is a potential canonical vocabulary source for cross-source entity normalization in a rewrite — solving the entity consolidation problem where molecules, indications, and other entities exist under different names across ClinicalTrials.gov, SAMI, and the TA Portal.

## Authentication

- OAuth2 authorization code flow via `https://wam.roche.com/as/authorization.oauth2`
- Basic auth also works for interactive use
- Some endpoints (e.g., terminology export) require elevated privileges

## API Structure

309 endpoints across three API versions:

| Path prefix | Purpose |
|-------------|---------|
| `/v3/*` | External read-only API (applications, terminologies, concepts) |
| `/v2/*` | Legacy external API |
| `/int/*` | Internal API (full CRUD, search, curation, admin) |

## Available Reference Terminologies

39 reference terminologies. The ones relevant to clinical trials data:

| Terminology | Concepts | Alt Labels | Cross-refs | Relevance |
|-------------|----------|------------|------------|-----------|
| **Indication** | 5,869 | 15,122 | 27,204 | Normalize CT.gov conditions + TA Portal indications |
| **Competitor Drug** | 1,233 | 2,716 | 4,276 | Drug/molecule normalization (non-Roche compounds) |
| **Organization** | 35,579 | 46,524 | 27,579 | Sponsor/CRO normalization |
| **Organ Tissue Cell** | 2,312 | 5,523 | 7,548 | Map to AE organ systems, sample tissue types |
| **Human Protein, target and MoA** | 49,658 | 75,094 | 14,457 | Drug target standardization |
| **Unit** | 668 | 1,587 | 539 | Lab value unit normalization |
| **Geographic Location** | 697 | 1,508 | 2,095 | Country/region standardization |
| **Intervention and Intervention products** | 580 | 842 | 457 | Procedure/specimen type vocabulary |
| **Scientific Area** | 199 | 196 | 283 | Therapeutic area normalization |
| **Phase** | 56 | 146 | 43 | Canonical phase vocabulary |

Other available terminologies: Bioassay, Biomedical Knowledge, Compound Tool, Currency, Data Governance, Digital Repository, Document Type, Drug Type, Gene-Human, Gene-Non Human, General Knowledge, Genetics & Genomics, Informatics, Measurement and Examination, Natural Language, Reagent, Roche Diagnostic and Device Product, Roche Organization, Role Profile, Route and method of administration/dosage form, Species Strain, Substance Type, plus several Special Purpose code lists.

## Terminology Structure

Each terminology is a hierarchical concept scheme:

- **Concepts** have a preferred label, alternative labels (synonyms), and a status (Active/Obsolete)
- **Hierarchy** via broader/narrower (SKOS-style). Example from Indication:
  ```
  Neoplasm
    └── Breast disorder
          ├── Breast lump
          ├── Fibrocystic breast disorder
          ├── Gynecomastia
          ├── Lactation disorder
          │     └── ...
          └── Mastitis
  ```
- **Cross-references** (xrefs) link to external ontologies (NCI Thesaurus, UMLS, MedDRA, etc.)
- **Definitions** are curated, often with literature references (PMIDs)

The Indication terminology has 147 active top-level concepts with 93 having children, organized into disease-system categories (Cardiovascular disorder, Neurological disorder, Neoplasm, Infectious disease, etc.).

## Key Value for the Rewrite

### 1. Indication Normalization
5,869 curated indications with 15,122 synonyms could serve as the canonical vocabulary for normalizing:
- ClinicalTrials.gov `conditions` (free-text, inconsistent)
- TA Portal `indication` field
- Eligibility criteria disease references

### 2. Drug/Molecule Resolution
Competitor Drug (1,233 concepts) + whatever Roche-internal molecule terminology exists could resolve the brand vs. generic vs. abbreviation problem across data sources.

### 3. Organization Standardization
35,579 organizations with 46,524 alternative names — could normalize sponsor names, CROs, and institution names across CT.gov and TA Portal.

### 4. Cross-Reference Network
The 27,204 cross-references on Indication alone link to established medical ontologies (NCI, UMLS, MedDRA), enabling interoperability beyond Roche's internal systems.

## API Access Patterns

| What | Endpoint | Auth Level |
|------|----------|------------|
| List terminologies | `GET /v3/refterminologies` | Basic read |
| Terminology stats | `GET /int/refterminologies/{tid}/stats` | Basic read |
| Top-level concepts | `GET /int/refterminologies/{tid}/topconcepts` | Basic read |
| Concept detail | `GET /int/refterminologies/{tid}/concepts/{cid}` | Basic read |
| Concept children | `GET /int/refterminologies/{tid}/concepts/{cid}/narrower` | Basic read |
| Concept parents | `GET /int/refterminologies/{tid}/concepts/{cid}/broader` | Basic read |
| Search | `POST /int/search` (JSON-LD) | Basic read |
| Export concepts | `POST /int/appterminologies/{tid}/concepts/export` | Elevated (curator?) |

## Integration Considerations

- **API format:** JSON-LD, not plain JSON — responses use `@context`, `@graph` structure
- **Authentication:** OAuth2 required; service account or token caching needed for automated access
- **Rate limiting:** Unknown — needs testing for bulk concept retrieval
- **Freshness:** Terminologies are curated (owner-managed); update frequency varies per terminology
- **Read-only access:** The external v3 API is read-only; curation goes through the internal API with curator privileges
- **Concept IDs:** ROX-prefixed (e.g., `ROX1305277804299`), stable and referenceable
