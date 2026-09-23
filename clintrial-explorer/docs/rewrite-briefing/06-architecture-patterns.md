# 6. Architecture & Patterns

## System Architecture

```
Browser (SPA)
  └── Vite dev proxy / Caddy reverse proxy
        ├── /server-api/* → Express server (port 3013)
        │     ├── Import orchestrator (CT.gov API client)
        │     ├── AI classification (Anthropic API)
        │     ├── AE cleanup (Anthropic API)
        │     ├── Bootstrap sequence
        │     └── Settings/config
        ├── /wip/* → @wip/proxy → WIP API
        │     ├── Document CRUD
        │     ├── Terminology/template management
        │     └── Reporting queries (PostgreSQL)
        └── /files/* → WIP file storage (MinIO)
```

## Backend: WIP

WIP is the storage backend. The app does not have its own database. Everything is stored as WIP documents:

- **MongoDB** stores all documents (JSON), terminologies, templates
- **PostgreSQL** is a reporting sync layer — WIP automatically syncs document data to PostgreSQL tables for SQL querying
- **MinIO** stores binary files (PDFs)
- **NATS** provides event streaming for real-time sync

The app uses WIP's SQL reporting layer for all read queries (via `reportQuery()`). Writes go through the WIP document API.

## Query Strategy

### All Trials (Bulk Load)

All ~4,100 trials are loaded in a single SQL query into the client at app startup. This enables:
- Instant client-side filtering across all filter dimensions
- Client-side TA enrichment (rule-based + ontology)
- Client-side match scoring (population explorer)
- Fast navigation between pages (shared state)

The query joins trial data with related availability flags (has AE data, has outcomes, has samples, etc.) as separate parallel queries that build `Set<nctId>` lookup tables.

**Tradeoff:** Simple, fast filtering. But loads all data upfront (~4MB payload), and client-side computation (enrichment, scoring) scales linearly with trial count.

### Sub-Entity Queries (On-Demand)

AEs, outcomes, sites, baselines, samples, eligibility are loaded on demand when the user navigates to a detail page or analytics view. These use SQL queries scoped by NCT ID or other filters.

### Criteria Browser (Server-Side)

The eligibility criteria browser uses server-side SQL via `jsonb_array_elements` to query the native criteria array field. Three query types:
- Group summary: `SELECT semantic_group, COUNT(*) GROUP BY semantic_group`
- Group detail: criteria within a group, paginated
- Search: ILIKE across group labels

This was moved from client-side aggregation (which hit array size limits at 100 elements) to server-side SQL.

### Full-Text Search

Two FTS mechanisms:
- **Eligibility criteria:** PostgreSQL tsvector/GIN index on `criteria_json` field. Used for deep eligibility search.
- **Trial text:** Quick substring search (client-side) on NCT ID, title, conditions, molecules.

---

## Auth Model

Headers `x-wip-user` and `x-wip-groups` are injected by the WIP gateway (Caddy + OIDC). The Express server maps groups to roles:
- `ct-admin` group → admin role (can access import, config)
- `ct-user` group → user role (standard features)
- No matching group → read-only
- No OIDC issuer configured → all users are admin (dev mode)

---

## Import Pipeline

The ClinicalTrials.gov import is a multi-phase server-side pipeline:

1. Server-side orchestrator manages phases, batching, error handling, cancellation
2. Progress is streamed to the client via Server-Sent Events (SSE)
3. Each phase processes entities in batches (trials in batches of 100)
4. Identity-based upsert means re-imports are idempotent — unchanged data creates new versions only if data actually changed
5. Sync state tracking enables incremental imports (skip unchanged trials)

**PDF handling:** Protocol documents are downloaded from CT.gov, uploaded to WIP's MinIO storage, and linked to trial documents via file reference IDs.

---

## Bootstrap

Fresh install sequence (triggered by BootstrapGate UI component):

1. Check if `clintrial` namespace exists
2. If missing: offer bootstrap (never auto-bootstrap)
3. On user confirmation:
   - Create namespace
   - Create 28 terminologies from seed JSON files (with terms and ontology relations)
   - Create 19 templates from seed JSON files (numbered for dependency order)
   - Load 4 normalization mapping CSVs (~14,600 rows total)
   - Write BOOTSTRAP_RECORD audit document
4. After bootstrap: data import (CT.gov, SAMI, TA Portal) is still needed

Seed files are committed to git under `server/seed/`. Bootstrap is idempotent via WIP's identity-based upsert.

---

## Client-Side Enrichment

Three computation patterns run in the browser:

1. **TA enrichment:** Classification rules + ontology ancestor walk applied to all trials in `useMemo`. Runs on every filter state change.

2. **Match scoring:** Population profile requirements compared against trial eligibility fields. Each trial gets a score (confirmed/silent/contradicted per field).

3. **AE term resolution:** Raw AE strings mapped to canonical terms, with row-level merging and count aggregation.

---

## Data Flow

```
ClinicalTrials.gov API
  → Import pipeline (server)
    → WIP documents (MongoDB)
      → PostgreSQL reporting sync (automatic)
        → SQL queries (reportQuery)
          → React hooks (useQuery)
            → UI components

SAMI CSV / TA Portal CSV
  → Upload endpoint (server)
    → WIP documents (MongoDB)
      → PostgreSQL reporting sync
        → SQL queries → UI

Normalization mappings (CSV seed files)
  → Bootstrap loader
    → WIP documents (MongoDB)
      → PostgreSQL reporting sync
        → Query-time JOINs
```

---

## Key Libraries

| Library | Role |
|---------|------|
| @wip/client | TypeScript client for WIP API (document CRUD, reporting queries) |
| @wip/react | React hooks wrapping @wip/client with TanStack Query |
| @wip/proxy | Express middleware proxying /wip/* to WIP backend with API key injection |
| @tanstack/react-query | Data fetching, caching, invalidation |
| recharts | Charts (bar, pie, heatmap) |
| lucide-react | Icons |
| Tailwind CSS 3 | Styling |

---

## Configuration

| Variable | Purpose |
|----------|---------|
| WIP_BASE_URL | WIP backend URL (default: https://localhost:8443) |
| WIP_API_KEY | Namespace-scoped API key for runtime access |
| PORT | Express server port (default: 3013) |
| APP_BASE_PATH | URL prefix for deployed app |
| OIDC_ISSUER | OIDC provider URL (enables auth) |
| ANTHROPIC_API_KEY | For AI features (AE cleanup, TA classification) |
