# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A clinical trials application built on WIP (World In a Pie) — a universal template-driven document storage system. WIP is the backend; this repo contains the frontend that maps the clinical trials domain onto WIP's primitives (terminologies, templates, documents).

## The Golden Rule

> **Never modify WIP. Build on top of it.**

## Process

Follow the 4-phase development process using slash commands, in order:

1. `/explore` — Read MCP resources, discover existing data model, understand the domain
2. `/design-model` — Map the domain to WIP primitives (user must approve before proceeding)
3. `/implement` — Create terminologies and templates in WIP, verify with test documents
4. `/build-app` — Scaffold and build the React/TypeScript application

**After Phase 4:** `/improve` (iterate), `/document` (generate docs)

**Available anytime:** `/wip-status`, `/export-model`, `/bootstrap`, `/add-app`, `/resume`

**Context management:** When context reaches ~70-80%, run `/resume` or save state before compaction.

## Reference Documentation

Read these before starting:
- `docs/AI-Assisted-Development.md` — 4-phase process, data model design guide, PoNIFs quick reference
- `docs/WIP_PoNIFs.md` — Full guide to WIP's 6 non-intuitive behaviours
- `docs/WIP_DevGuardrails.md` — UI stack, app skeleton, testing conventions

## MCP

WIP is accessed exclusively via MCP tools (68 tools, 4 resources). Before starting, read these MCP resources:
- `wip://conventions` — bulk-first API, identity hashing, versioning
- `wip://data-model` — terminologies, templates, documents, fields, relationships
- `wip://ponifs` — 6 behaviours that trip up every new developer
- `wip://development-guide` — full 4-phase workflow reference

A ClinicalTrials.gov MCP server is also available for searching and analyzing FDA-regulated clinical studies (search_trials, get_trial_details, search_by_sponsor, analyze_endpoints, search_investigators, search_by_eligibility).

## WIP PoNIFs (Critical)

These 6 non-intuitive behaviours will cause bugs if forgotten. Re-read after context compaction.

| # | PoNIF | What You Expect | What WIP Does |
|---|-------|----------------|---------------|
| 1 | Nothing Ever Dies | Delete removes entities | Deactivate only. Inactive = retired, not gone. |
| 2 | Template Versioning | Update replaces old version | Update creates new version. Old stays active. Always pass `template_version`. |
| 3 | Document Identity | POST creates, PUT updates | Identity hash from `identity_fields` determines create vs update. Same hash = new version. |
| 4 | Bulk-First 200 OK | HTTP status indicates success | Always 200. Check `results[i].status` for per-item outcomes. |
| 5 | Registry Synonyms | One ID per entity | Multiple IDs normal. Merge to reconcile. |
| 6 | Template Cache | Changes take effect immediately | Cached up to 5 seconds. Restart service if urgent. |

## Data Model Design Rules

- Use `value`/`label` (not `code`/`name`), `mandatory` (not `required`), `terminology_ref` (not `terminology_id`)
- Use `type: "reference"` for cross-document links, never `type: "string"`
- Identity fields determine versioning: too many = corrections create new docs; too few = different entities collide; none = append-only
- Never add timestamps or run-specific data to document fields (breaks idempotent import)
- Creation order: terminologies -> terms -> templates (referenced first) -> documents (referenced first)

## UI Stack (Phase 4)

| Concern | Choice |
|---------|--------|
| Framework | React 18+ |
| Build | Vite |
| Styling | Tailwind CSS |
| Components | shadcn/ui (Radix primitives) |
| Icons | Lucide React |
| Data fetching | TanStack Query |
| Routing | React Router v6+ (must support configurable base path) |
| Charts | Recharts |
| Testing | Vitest + Testing Library (unit), Playwright (E2E) |

## Client Libraries

For Phase 4, install from tarballs:
```bash
npm install ./libs/wip-client-*.tgz ./libs/wip-react-*.tgz
```

- `libs/wip-client-README.md` — TypeScript client (6 services, error hierarchy, bulk abstraction)
- `libs/wip-react-README.md` — React hooks (TanStack Query, 30+ hooks)

## App Structure

```
app-name/
  app-manifest.json       # Gateway registration
  Dockerfile              # Multi-stage: Node build -> Caddy serve
  vite.config.ts
  tailwind.config.ts
  src/
    main.tsx, App.tsx
    lib/config.ts          # Runtime config (WIP URL, base path)
    components/, pages/, hooks/, types/
  tests/
    e2e/, unit/
```

Environment variables: `VITE_WIP_HOST`, `VITE_WIP_API_KEY`, `VITE_BASE_PATH`, `VITE_APP_PORT`
