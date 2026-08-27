# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Honesty & Grounding Pass

#### Added
- Zotero import pagination and collection filtering.
- Browser extension project picker: papers are saved to an explicitly selected project instead of silently using the first one.

#### Changed
- Ask-AI, literature matrix, and discovery grounded in real retrieval and live Crossref lookups instead of simulated results.
- AI features return honest `503 Service Unavailable` responses when no LLM provider is configured.
- WebSocket collaboration persists document edits (`doc_edit` broadcasts) to the database.
- Browser extension slimmed for single-user local mode: token storage and Authorization headers removed (local backend needs no auth), background service worker and content scripts deleted, permissions reduced to `localhost` with optional broad-host grants.

#### Fixed
- BibTeX escaping and validation hardening.
- Teams role validation and last-owner protection.
- Document version-number uniqueness enforced.
- Frontend fake-success cleanups: add-to-library performs a real API call, claims counter wired to actual data, find-sources query passed through to the backend, misleading collaborator avatar and phase badges removed.

#### Removed
- Simulated evaluation benchmark and demo seed data.

---

### Phase 7 — Code Quality, Testing & Documentation

#### Added
- Vitest test infrastructure for all frontend packages (`citations`, `editor`, `ai`, `research`, `plugins`, `ui`) with a 70% global coverage threshold gate (lines, branches, functions, statements).
- Unit tests for the BibTeX parser covering nested braces, special characters, malformed entries, and balanced-brace tokenization.
- Unit tests for CSL citation styles covering author formatting edge cases across APA, MLA, Chicago, Harvard, IEEE, and Vancouver.
- Unit tests for TipTap editor extensions: citation node attribute parsing/rendering, math equation KaTeX rendering, trust marker superscript glyphs, claim verification marks, and the ghost-text plugin state machine.
- Type-level test suites (`*.test-d.ts`) with `expectTypeOf` compile-time assertions for the citations and editor packages.
- Backend quality-gate tests closing coverage gaps in RAG chunking pipeline (abstract/sections/tables/equations, sliding-window sub-chunking), hybrid search modes, teams endpoint error paths, version history lifecycle (create/list/diff/restore), Zotero import deduplication, plugin registration/hook dispatch, and embedding service edge cases.
- `docs/architecture.md` system overview diagram.

#### Changed
- Renamed single-letter variables to intention-revealing names in the export engine (`docx_exporter.py`, `pdf_exporter.py`, `csl_formatter.py`, `intelligence_service.py`): `c` → `citation`, `p` → `paper`/`para`, `h` → `heading`, `p_run`/`h_run` → `run`/`heading_run`.
- Coverage configuration now includes editor extensions and excludes type-only modules and abstract provider base classes.

#### Metrics
- Frontend package coverage: 88.6% lines / 72% branches / 83% functions (94 tests passing).
- Backend coverage: 90% statements (189 tests passing).

---

### Phase 6 — DevOps, Portability & CI/CD

#### Added
- GitHub Actions CI pipeline (`.github/workflows/ci.yml`): frontend lint/typecheck/build, backend ruff + pytest, Docker image build checks.
- Pre-commit hooks (ruff, mypy, eslint, prettier) and Dependabot configuration.
- Docker images: `infrastructure/Dockerfile.api` (Python 3.11-slim) and `infrastructure/Dockerfile.web` (Node 20 multi-stage) plus `.dockerignore`.
- Dev Container configuration for consistent development environments.
- Version pinning: `.nvmrc`, `.python-version`, `engines` field in root `package.json`.

#### Changed
- Optional heavy dependencies (psycopg2-binary, pgvector) moved to optional dependency groups.
- Browser extension permissions narrowed from wildcard `https://*/*` to academic domains.
- Global plugin administration restricted to admin RBAC.
- Audit reports relocated from root `report/` into `docs/audits/`.

#### Removed
- Stale `.meteor/` directory; unused `redis` Python dependency.

---

### Phase 5 — UI/UX, Radix Migration & Accessibility

#### Added
- `packages/ui`: shared CVA-based component library (`dialog`, `dropdown-menu`, `popover`, `tabs`, `tooltip`, `select`, `badge`, `button`) with `cn()` utility.
- WCAG 2.1 AA compliant color tokens (light & dark themes verified with axe-core).
- Responsive layout with mobile navigation drawer, auto-collapsing source panel, and toolbar overflow menu.
- Web fonts loaded via `next/font/google` (Source Serif 4, JetBrains Mono).

#### Changed
- All 13 modals migrated to `@radix-ui/react-dialog` with focus trapping, portals, scroll locking, and ARIA roles.
- Dropdowns, popovers, tabs, and tooltips migrated to Radix primitives with keyboard navigation and collision-aware positioning.
- Emoji icons replaced with Lucide SVG icons.
- Focus-visible rings added to modal inputs; clickable `div`s replaced with semantic buttons; touch targets enlarged to >= 36px.

---

### Phase 4 — Type Safety & Language Modernization

#### Fixed
- Three fatal runtime crash sites: BibTeX parser index access without null checks, citation formatter bounds error on two-author arrays, and ghost-text source badge crash on empty sources array.
- BibTeX nested brace truncation via balanced brace tokenizer.
- TypeScript compiler target downleveled to ES2022 consistently across the monorepo.
- 174 `any` type instances eliminated from the API client layer; typed DTOs introduced throughout.
- Untyped error catching replaced with `catch (error: unknown)` patterns.

#### Changed
- Python codebase modernized to 3.12 typing syntax (829+ occurrences); deprecated `datetime.utcnow()` replaced with timezone-aware equivalents.
- All Ruff lint violations resolved (888 → 0); SQLAlchemy models migrated to 2.0-style `Mapped[]` declarations.

---

### Phase 3 — Architecture, Async & Backend Restructuring

#### Added
- Alembic migration infrastructure.
- SSE streaming for AI writing endpoints; correlation IDs with structured JSON logging; global structured error envelope.
- Pagination across all list endpoints; optimistic locking version column on documents.

#### Fixed
- Blocking file I/O and synchronous DB operations inside async endpoints offloaded.
- CPU-bound PDF parsing moved off the event loop.
- N+1 query elimination in teams, comments, and citations listings (verified with SQL logging).

#### Changed
- God-files decomposed: `AppShell.tsx` (1,497 lines), `export_service.py` (1,049 lines), `api.ts` (729 lines), `chunk_paper()`, and `analyze_research_gaps()` split into focused units.
- DRY extractions: centralized author formatting, sentence splitting, and NLP stop-word lists.

---

### Phase 2 — Stability, Memory Safety & Resource Lifecycle

#### Fixed
- Unbounded backend response cache replaced with LRU eviction (`max_entries=2000`).
- Unbounded frontend research cache bounded at 500 entries with LRU semantics.
- WebSocket disconnect cleanup moved to unconditional `finally` blocks; ephemeral UUID connection IDs replace object-identity strings.
- Upload progress timers cleared on error paths; DOM element references released in browser extension content scripts.

#### Changed
- Shared singleton HTTP client pool attached to app state for external API calls.
- Database initialization migrated from import-time side effects to FastAPI lifespan handler.

---

### Phase 1 — Security, Authentication & Fresh-Clone Blockers

#### Security
- JWT authentication enforced on WebSocket collaboration endpoint and Research Intelligence endpoints.
- Zotero sync endpoints require authentication and project membership verification.
- Provider cache flush restricted to admin users.
- Production startup validation aborts when default `SECRET_KEY` is combined with `ENVIRONMENT=production`.

#### Removed
- Committed SQLite databases and user upload artifacts; comprehensive `.gitignore` established.

#### Fixed
- Missing Python dependencies declared (`pdfplumber`, `email-validator`, `bcrypt`, `requests`).
- CORS origins made configurable via `CORS_ORIGINS`; env var name mismatches between config and Docker resolved.
- Password complexity validation (`min_length=8`) on user registration.

#### Added
- Root `README.md` quickstart; `.env.example` templates; missing Dockerfiles for self-hosted deployment.
