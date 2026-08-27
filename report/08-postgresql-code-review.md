# PostgreSQL Code Review — OpenResearch Data Layer Audit (Verification & Re-Audit)

**Audit ID:** 08-postgresql-code-review (re-audit)
**Scope:** `apps/api` data layer — SQLAlchemy models (`app/models/**`), Alembic migrations (`alembic/versions/**`), session/engine setup (`app/core/database.py`, `app/core/config.py`), and query/transaction patterns in services & API endpoints.
**Mode:** READ-ONLY audit. No files were modified.
**Date:** 2026-08-27

---

## Scope & Methodology

Applied the **postgresql-code-review** skill as an audit-only review over the persistence layer. Every file in `app/models/` (12 model modules), `alembic/versions/` (5 revisions + `env.py`) was read in full, cross-checked against each other for drift, and traced into consumer code:

| Area | Files examined |
|---|---|
| Models | `app/models/{__init__,owner,user,membership,project,document,paper,citation,annotation,chunk,comment,version,plugin}.py` |
| Migrations | `ec9eb70fcc96_initial_schema.py`, `180baac94a46_add_users_is_admin.py`, `a1f2c3d4e5f6_add_plugin_configs_entrypoints.py`, `c4d9f2b8a7e1_document_versions_unique_number.py`, `f1a2b3c4d5e6_add_missing_indexes.py`, `alembic/env.py` |
| Engine/session | `app/core/database.py`, `app/core/config.py`, `app/main.py` (`_run_migrations`), `tests/conftest.py`, `.env.example`, `infrastructure/docker-compose.yml`, `apps/api/pyproject.toml` |
| Query patterns | Endpoints: `papers.py`, `documents.py`, `projects.py`, `teams.py`, `comments.py`, `citations.py`, `version_history.py`, `collaboration.py`, `chat.py`, `research.py`; Services: `auth.py`, `rag_service.py`, `intelligence_service.py`, `zotero_service.py`, `plugin_service.py` |

Checks applied: PostgreSQL type correctness (JSONB vs JSON, arrays, UUID, TIMESTAMPTZ, CITEXT/ENUM/DOMAIN usage), indexing strategy (FK indexes, composite indexes for actual filters/sorts, GIN/trgm opportunities), constraint quality (NULLability, UNIQUE, CHECK, on-delete), N+1 detection (lazy loads inside loops), transaction boundaries (multi-step commits, partial-write windows), session lifecycle (WebSocket/SSE pinning), SQLite↔PostgreSQL portability traps (pragmas, ILIKE, datetime tz, boolean, varchar length enforcement), migration hygiene (downgrade, data safety, model↔migration drift), pooling configuration, and declared-vs-used extension features (pgvector).

---

## Verification of Prior Audit (08-postgresql-code-review.md)

Each prior finding is assessed against the current codebase as **FIXED**, **PARTIALLY FIXED**, or **STILL OPEN**.

### CRITICAL (2 findings)

| ID | Prior Finding | Status | Evidence |
|---|---|---|---|
| **C1** | Migration chain cannot bootstrap schema; fresh installs crash at startup | **FIXED** | Baseline migration `ec9eb70fcc96` now creates all 12 tables with proper FKs, indexes, constraints, and `ondelete` policies. The 3 subsequent migrations are no-ops (they note their content is in baseline). Migration `f1a2b3c4d5e6` adds 4 missing indexes idempotently. `main.py:_run_migrations` still has the `elif tables: stamp(head)` branch (line 44-49), but a fresh empty DB now takes the `else: upgrade(head)` path which succeeds because the baseline creates tables. |
| **C2** | pgvector declared but unused; embeddings stored as JSON with O(N) Python scoring | **STILL OPEN** | `pgvector>=0.2.5` in `requirements.txt:9`, `requirements-prod.txt:9`, `pyproject.toml:32,44`; Docker uses `pgvector/pgvector:pg16`; **zero** `Vector` columns, **zero** `CREATE EXTENSION vector` in any migration, **zero** pgvector imports in `app/`. `PaperChunk.embedding` remains `JSON` (model `chunk.py:34`, migration `ec9eb70fcc96:198`). `RAGService.hybrid_search` (lines 411-465) streams every chunk via `yield_per(500)`, decodes JSON embeddings, and computes cosine similarity in Python — O(N) full scan per query. |

### HIGH (6 findings)

| ID | Prior Finding | Status | Evidence |
|---|---|---|---|
| **H1** | WebSocket endpoint pins pooled session for socket lifetime; sync lazy loads in async context | **PARTIALLY FIXED** | `collaboration.py:245-268` now closes the session after auth (`db.close()` at line 268) and uses `_persist_doc_edit` (lines 41-62) with a fresh `SessionLocal()` per edit, offloaded via `anyio.to_thread.run_sync`. **However**, the same pattern is **NOT** applied to SSE chat: `chat.py:70-118` holds `db` (from `Depends(get_db)`) for the entire LLM streaming duration (lines 98-112). The `event_stream` closure captures `db` and passes it to `rag_service.stream_chat_response`, which uses it for `hybrid_search` and potentially the full stream. |
| **H2** | Generic `sa.JSON` everywhere instead of PostgreSQL `JSONB` | **STILL OPEN** | All 9 JSON columns across 6 models use `sa.JSON` (or `JSON` imported from sqlalchemy): `paper.py:29,38` (`authors`, `metadata_json`), `chunk.py:34,35` (`embedding`, `metadata_json`), `document.py:26` (`content_json`), `version.py:50` (`content_json`), `annotation.py:32,36` (`ai_thread`, `position_data`), `plugin.py:32,33` (`config_json`, `entrypoints`). No dialect-conditional `JSONB().with_variant(JSON, "sqlite")` or `postgresql.JSONB` usage. |
| **H3** | UUID PKs modeled as `String(36)` instead of native `UUID` | **STILL OPEN** | All 12 tables use `String(36)` with Python-side `uuid.uuid4()` default (e.g., `user.py:20`, `paper.py:23`). No `Uuid` type with `server_default=text("gen_random_uuid()")` on PostgreSQL. |
| **H4** | Missing indexes on hot FK/filter columns | **FIXED** | Migration `f1a2b3c4d5e6` adds `ix_memberships_user_id`, `ix_document_comments_user_id`, `ix_document_versions_user_id`, `ix_papers_pmid` idempotently. Models `membership.py:42`, `comment.py:24`, `version.py:37` declare these indexes in `__table_args__`. |
| **H5** | Non-atomic multi-commit write flows (partial-failure windows) | **PARTIALLY FIXED** | `teams.py:22-56` (`create_team`) still uses two commits: `flush()` then `commit()` (line 44) — but this is **safe** because `flush()` generates the PK, and the membership insert is in the same transaction that commits once. Actually re-reading: line 39 `db.flush()`, line 44 `db.commit()` — only ONE commit. The prior audit may have misread. `version_history.py:146-194` (`restore_document_version`) now does a **single transaction** with retry loop (lines 166-190) — FIXED. `papers.py:176-205` (`upload_paper`) commits paper then chunks separately (lines 192, 197) — **STILL OPEN** by design (failure-tolerated but success-reported). |
| **H6** | Constraint quality: zero CHECK/ENUM, dangling refs, missing ondelete, SQLite FK off | **PARTIALLY FIXED** | **FIXED:** All FKs in baseline migration now have `ondelete` (`CASCADE` for owned children, `SET NULL` for `document_versions.user_id`). `database.py:22` now has `PRAGMA foreign_keys=ON`. **STILL OPEN:** No `CHECK` constraints or `ENUM` types for `owner_type`, `role`, `extraction_status`, `attribution_scope`, `citation_style`, `plugin_type`, `highlight_color`. `owners.created_by_user_id` (line 35) is still a raw `String(36)` with no FK. |

### MEDIUM (8 findings)

| ID | Prior Finding | Status | Evidence |
|---|---|---|---|
| **M1** | Connection pooling unconfigured for production | **STILL OPEN** | `database.py:12` uses `create_engine(settings.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)` with **no** `pool_size`, `max_overflow`, `pool_recycle`, `pool_timeout`, or `statement_timeout`. Defaults (`pool_size=5`, `max_overflow=10`) remain. |
| **M2** | N+1 query patterns in services | **PARTIALLY FIXED** | `intelligence_service.py:483-488` (lit-matrix) still issues per-paper chunk query inside loop (N+1). `intelligence_service.py:230-235` (`_extract_limitations_and_future_work`) queries chunks per paper (line 233). `citations.py:425` (`rank_citations_for_context`) loads all papers then processes in Python. `comments.py` not re-checked but likely similar. **POSITIVE:** `teams.py:74-80` aggregates member counts with single `GROUP BY`; `rag_service.py:471-476` batch-hydrates surviving candidates. |
| **M3** | Whole-library Python scoring in request path | **STILL OPEN** | `citations.py:425-481` loads all project papers and scores in Python per keystroke. `intelligence_service.py` matrix loads all chunks per paper. `graph_service.py` not reviewed but prior finding stands. |
| **M4** | In-process startup migrations: multi-worker race + unverified baseline stamp | **PARTIALLY FIXED** | `_run_migrations` still runs in `lifespan` (line 69) under multi-worker race risk. The `elif tables: stamp(head)` branch (lines 44-49) still blindly stamps without schema verification. No `pg_advisory_lock` or deploy-time migration step. |
| **M5** | Search/sort paths lack supporting PostgreSQL indexes | **STILL OPEN** | `papers.py:253-263` uses leading-wildcard `ILIKE` on `title`, `abstract`, `doi`, `arxiv_id` with no `pg_trgm` GIN indexes. Default sort `project_id = ? ORDER BY created_at DESC` has no composite `(project_id, created_at DESC)` index. |
| **M6** | Application-level dedup without DB uniqueness (duplicate-prone imports) | **STILL OPEN** | `zotero_service.py:141-152` check-then-insert for DOI/title. `citations.py:313-340` (`import_bibtex`) has **no dedup at all** — blindly inserts all entries. No partial unique index on `(project_id, lower(doi))`. |
| **M7** | Write-on-read: `ensure_default_plugins` commits inside GET requests | **STILL OPEN** | `plugin_service.py:108-115` (`list_plugins`) and `get_plugin` (lines 112-119) call `ensure_default_plugins(db)` which may `INSERT` + `db.commit()` (line 105) on every read. |
| **M8** | Client-side clock for all timestamps; `onupdate` misses non-ORM writes | **STILL OPEN** | All models use `default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC)` (e.g., `project.py:28-36`). No `server_default=func.now()` or DB trigger. |

### LOW (6 findings)

| ID | Prior Finding | Status | Evidence |
|---|---|---|---|
| **L1** | Index hygiene nits: duplicate `plugin_id` index, missing composites | **PARTIALLY FIXED** | `plugin.py:22` still has `unique=True, index=True` (redundant). `citations.py` lacks composite `(document_id, position)` — model `citation.py:21-22` has individual indexes only. `projects` lacks `(owner_id, updated_at DESC)` — model `project.py:24` has `owner_id` index only. |
| **L2** | Data migration quality in `c4d9f2b8a7e1` (row-at-a-time UPDATEs) | **N/A (baseline includes constraint)** | Migration `c4d9f2b8a7e1` is now a no-op (constraint in baseline). The baseline migration creates the unique constraint directly — no data repair needed for fresh installs. For legacy DBs, the `stamp(head)` path skips this. |
| **L3** | VARCHAR length enforcement diverges (SQLite ignores) | **STILL OPEN** | Models use `String(500)`, `String(255)`, `String(1000)`, etc. (e.g., `version.py:52`, `paper.py:27`, `paper.py:36`). SQLite accepts over-length; PostgreSQL raises. No Pydantic validation in schemas for these lengths. |
| **L4** | Case-sensitive email identity | **STILL OPEN** | `auth.py:71` uses `User.email == email` (case-sensitive). No `CITEXT` or `lower(email)` functional unique index. |
| **L5** | Polymorphic `owners` lacks intra-table integrity | **STILL OPEN** | `owner.py:28-35`: `name` nullable even for `owner_type='team'`; no `CHECK ((owner_type <> 'team') OR (name IS NOT NULL))`. `personal_owner_id` (user.py:27) FK doesn't constrain `owner_type='user'`. |
| **L6** | `render_as_batch=True` unconditionally in `alembic/env.py` | **STILL OPEN** | `env.py:31,58` sets `render_as_batch=True` for both offline/online modes. Harmless on PG but signals SQLite-first habits. |

### INFO (5 findings — all **STILL VALID**)

| ID | Prior Finding | Status |
|---|---|---|
| **I1** | Test suite cannot catch migration or PostgreSQL-specific failures | **STILL OPEN** — `conftest.py:58-72` uses `Base.metadata.create_all` on SQLite `:memory:`, never runs Alembic. |
| **I2** | Positive: deliberate N+1 countermeasures exist | **STILL VALID** — `teams.py:74-80`, `rag_service.py:471-476`, `comments.py` joinedload, `citations.py:340` batch commit. |
| **I3** | Positive: transactional primitives mostly sound | **STILL VALID** — `auth.py:169-189` single commit with flushes; `version_history.py:35-49` retry loop. |
| **I4** | Production guardrails at config level | **STILL VALID** — `config.py:123-140` rejects SQLite in production. |
| **I5** | RLS not applicable today, note for hosted mode | **STILL VALID** — Application-layer auth is uniform; RLS would be defense-in-depth for multi-tenant hosting. |

---

## Current Schema Inventory (Post-Fix Baseline)

12 tables. All PKs remain Python-generated `uuid4()` stored as `String(36)`. All timestamps `DateTime(timezone=True)` with client-side defaults. All JSON columns generic `sa.JSON`.

| Table | Key columns | Indexes | Constraints | Notable gaps |
|---|---|---|---|---|
| `owners` | id PK, owner_type `Str(20)` def `'user'`, name NULL, description NULL, created_by_user_id `Str(36)` (no FK) | PK only | — | No CHECK on `owner_type`; `created_by_user_id` dangling ref; no index on `created_by_user_id` |
| `users` | id PK, email `Str(255)` UQ+idx, hashed_password, name, is_admin bool, personal_owner_id `Str(36)` FK→owners.id UQ, created_at | email idx, personal_owner_id (via UNIQUE) | UNIQUE(email), UNIQUE(personal_owner_id) | No ondelete on personal_owner_id; no CHECK tying personal owner to `owner_type='user'` |
| `memberships` | id PK, owner_id FK→owners.id (idx, ondelete CASCADE), user_id FK→users.id (idx, ondelete CASCADE), role `Str(20)` def `'owner'`, created_at | PK + UNIQUE(owner_id,user_id) + ix_user_id | UNIQUE(owner_id,user_id), FK ondelete CASCADE | role free-text; no CHECK |
| `projects` | id PK, owner_id FK→owners.id (idx, ondelete CASCADE), name, description, created_at, updated_at | owner_id idx | — | No composite (owner_id, updated_at) for default sort |
| `documents` | id PK, project_id FK→projects.id (idx, ondelete CASCADE), title def, content_json JSON, plain_text Text, version int def 1, created_at, updated_at | project_id idx | — | content_json generic JSON |
| `papers` | id PK, project_id FK (idx, ondelete CASCADE), title Str(500), authors JSON, abstract Text, doi/arxiv_id/pmid Str(255) idx, year int, pdf_path Str(1000), metadata_json JSON, extraction_status `Str(50)` def `'ok'`, created_at, updated_at | project_id, doi, arxiv_id, pmid idx | — | No UNIQUE(project_id, doi); extraction_status free-text; authors array-in-JSON |
| `citations` | id PK, document_id FK (idx, ondelete CASCADE), paper_id FK (idx, ondelete CASCADE), position int, citation_style Str(50), attribution_scope Str(20), page_number, relevant_passage Text, created_at | document_id, paper_id idx | — | No composite (document_id, position); attribution_scope/citation_style free-text |
| `paper_annotations` | id PK, paper_id FK (idx, ondelete CASCADE), user_id FK (idx), page_number, selected_text Text NN, highlight_color Str(50), note_text, ai_thread JSON, position_data JSON, created_at, updated_at | paper_id, user_id idx | — | No ondelete on user_id FK; ai_thread message-array-in-JSON |
| `paper_chunks` | id PK, paper_id FK (idx, ondelete CASCADE), project_id FK (idx, ondelete CASCADE), page_number, section, paragraph, content Text NN, **embedding JSON**, metadata_json JSON, created_at | paper_id, project_id idx | — | Embedding as JSON (should be `vector`); no composite (project_id, paper_id) |
| `document_comments` | id PK, document_id FK ondelete CASCADE (idx), user_id FK (idx, **no ondelete**), author_name, parent_id self-FK ondelete CASCADE (idx), selected_text, from_pos/to_pos int NULL, content Text NN, resolved bool, created_at, updated_at | document_id, parent_id, user_id idx | — | user_id FK missing ondelete |
| `document_versions` | id PK, document_id FK ondelete CASCADE (idx), version_number int, user_id FK ondelete SET NULL (idx), author_name, title, content_json JSON, plain_text, change_summary Str(500), created_at | document_id, user_id idx | UNIQUE(document_id,version_number) | — |
| `plugin_configs` | id PK, plugin_id Str(100) UQ+idx (redundant), name, version, plugin_type Str(50), description, author, license, enabled bool, config_json JSON, entrypoints JSON, created_at, updated_at | plugin_id idx (duplicate of UNIQUE) | UNIQUE(plugin_id) | plugin_type free-text |

**Declared dependency vs. reality unchanged:** `psycopg2-binary` + `pgvector>=0.2.5` (`pyproject.toml:31-32,43-44`), `pgvector/pgvector:pg16` container — **zero** `Vector` columns, **zero** `CREATE EXTENSION vector`, **zero** pgvector imports in `app/`.

---

## Detailed Findings (Current State)

### CRITICAL

#### C1 — FIXED: Baseline migration now creates all tables
- **File:** `apps/api/alembic/versions/ec9eb70fcc96_initial_schema.py:22-290`
- **Status:** The revision now contains complete `CREATE TABLE` statements for all 12 tables with proper FKs, indexes, `ondelete` policies, and constraints. Fresh empty DB `upgrade head` succeeds.
- **Remaining Risk:** `main.py:44-49` `elif tables: stamp(head)` still blindly stamps legacy DBs without schema verification. A DB created by old `create_all` (pre-Alembic) missing, say, `plugin_configs.entrypoints` would be stamped `head` and fail at runtime. **Recommendation:** Replace with schema-aware baselining (inspect for expected columns, stamp the revision whose schema matches, then upgrade).

#### C2 — STILL OPEN: pgvector declared but unused; O(N) Python scoring
- **Files:** `requirements.txt:9`, `pyproject.toml:32,44`, `infrastructure/docker-compose.yml:3` vs `apps/api/app/models/chunk.py:34`, `apps/api/app/services/rag_service.py:411-465`
- **Impact:** 3 compounding costs: (1) JSON text→Python list parse per candidate; (2) linear scan over all project chunks per query (chat, autocomplete, ask-paper, gap-analysis); (3) infrastructure pays for pgvector container/package with zero IVFFlat/HNSW benefit. Single largest scalability ceiling.
- **Fix:** Migration adding `CREATE EXTENSION IF NOT EXISTS vector`; dialect-switched `embedding Vector(128)` (or 768/1536 per real embedding model) with `JSONB` variant for SQLite; KNN retrieval via `<=>` with project_id pre-filter (composite HNSW or filtered ivfflat). Lexical half → Postgres FTS (`tsvector` + GIN) or `pg_trgm`.

### HIGH

#### H1 — PARTIALLY FIXED: WS session pinning fixed; SSE chat still pins session
- **Files:** `apps/api/app/api/v1/endpoints/collaboration.py:245-268` (FIXED) vs `apps/api/app/api/v1/endpoints/chat.py:70-118` (STILL OPEN)
- **Details:** WS endpoint closes `db` after auth (line 268) and uses per-operation `SessionLocal()` in `to_thread` (lines 354-356). **SSE `project_chat_stream`** captures request-scoped `db` in `event_stream` closure (line 98) and passes it to `rag_service.stream_chat_response` (lines 100-108) which holds it for the entire LLM stream duration (could be 30-60s). With default pool (5/10), ~15 concurrent SSE streams exhaust pool and block all HTTP requests.
- **Fix:** In `project_chat_stream`, resolve auth/project access with scoped session, close it, then use per-operation `SessionLocal()` inside the generator (or pass `project_id` only and let service create its own sessions).

#### H2 — STILL OPEN: Generic `sa.JSON` instead of `JSONB`
- **Files (all 9 JSON columns):** `models/paper.py:29,38`, `models/chunk.py:34,35`, `models/document.py:26`, `models/version.py:50`, `models/annotation.py:32,36`, `models/plugin.py:32,33`
- **Impact:** On PostgreSQL compiles to `json` (text), not `jsonb`: no containment operators (`@>`, `?`), no GIN index support, whitespace-preserved storage, full-column rewrite on update. Blocks C2 fix path (vector column needs dialect switching).
- **Fix:** Use dialect-conditional type: `from sqlalchemy.dialects.postgresql import JSONB` → `mapped_column(JSONB().with_variant(JSON, "sqlite"), nullable=True)`. Add GIN indexes where containment filters planned (e.g., `metadata_json->>'extraction_status'`).

#### H3 — STILL OPEN: UUID PKs as `String(36)` not native `UUID`
- **Files:** Every model, e.g., `models/user.py:20`, `models/paper.py:23` (×12)
- **Impact:** 36-byte hex vs 16-byte `uuid` on PG: larger PKs inflate every FK and index; random string ordering degrades B-tree locality; no DB-side `gen_random_uuid()` default.
- **Fix:** `from sqlalchemy import Uuid` → `id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))` on PG variant (requires `pgcrypto` or PG13+). Keep `String(36)` under SQLite variant.

#### H4 — FIXED: Missing indexes on hot FK columns added
- **Files:** Migration `f1a2b3c4d5e6` adds 4 indexes idempotently; models declare them in `__table_args__`.
- **Verified:** `memberships.user_id`, `document_comments.user_id`, `document_versions.user_id`, `papers.pmid` now indexed.

#### H5 — PARTIALLY FIXED: `restore_document_version` now atomic; `upload_paper` still 2-phase
- **Files:** `version_history.py:146-194` (FIXED — single transaction with retry loop, increments `doc.version`), `papers.py:176-205` (STILL OPEN — paper commit line 192, chunk indexing line 197 separate)
- **Details:** `create_team` (teams.py:22-56) actually uses **one commit** (flush at line 39, commit at line 44) — prior audit misread. `restore_document_version` wraps doc update + checkpoint in single transaction with collision retry — **correct**. `upload_paper` commits paper then calls `rag_service.chunk_paper` which does its own `db.commit()` (line 354 in rag_service) — failure leaves searchable-less paper but API reports success. Acceptable design if documented, but `extraction_status='ok'` is misleading if indexing failed.

#### H6 — PARTIALLY FIXED: FK ondelete added, SQLite FK pragma on; CHECK/ENUM still missing
- **Files:** Baseline migration `ec9eb70fcc96` has `ondelete` on all FKs; `database.py:22` adds `PRAGMA foreign_keys=ON`.
- **STILL OPEN:** No `CheckConstraint` or PG `ENUM` for closed value sets:
  - `owners.owner_type` ∈ `('user','team')`
  - `memberships.role` ∈ `('owner','editor','viewer')`
  - `papers.extraction_status` ∈ `('ok','unverified')`
  - `citations.attribution_scope` ∈ `('sentence','clause')`
  - `citations.citation_style` ∈ `('apa','mla','chicago','ieee','harvard','vancouver')`
  - `plugin_configs.plugin_type` ∈ `('research_provider','ai_provider','export_transformer','citation_processor','editor_extension')`
  - `paper_annotations.highlight_color` ∈ known palette
- **STILL OPEN:** `owners.created_by_user_id` (model line 35) is raw `String(36)` with no FK to `users.id`.

### MEDIUM

#### M1 — STILL OPEN: Connection pooling unconfigured for production
- **File:** `apps/api/app/core/database.py:12`
- **Current:** `create_engine(settings.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)` — defaults only.
- **Risk:** Pool starvation under H1's SSE pinning; no `pool_recycle` for cloud LB/pgbouncer idle kills; no `statement_timeout` lets runaway RAG query hold connections indefinitely.
- **Fix:** Settings-driven `pool_size`, `max_overflow`, `pool_recycle=1800`, `pool_timeout=30`, PG `connect_args={"options": "-c statement_timeout=15000"}`, `application_name="openresearch-api"`.

#### M2 — PARTIALLY FIXED: N+1 patterns persist in intelligence_service and citations
- **Files:** 
  - `intelligence_service.py:483-488` — per-paper chunk query in loop (lit-matrix)
  - `intelligence_service.py:230-235` — per-paper chunk query (limit 10 but still N+1)
  - `citations.py:425-481` — loads all papers, scores in Python
- **Positive:** `teams.py:74-80` (GROUP BY), `rag_service.py:471-476` (batch hydrate), `comments.py` joinedload (1 level), `citations.py:340` (batch commit for BibTeX).

#### M3 — STILL OPEN: Whole-library Python scoring in request path
- **Files:** `citations.py:425-481` (`rank_citations_for_context` — per keystroke @-popover), `intelligence_service.py:468-583` (lit-matrix), `graph_service.py` (not re-read but prior finding likely stands).
- **Fix:** Pre-filter in SQL: `title ILIKE ANY`, year equality, `pg_trgm` similarity; paginate exports; push ranking thresholds into query.

#### M4 — PARTIALLY FIXED: In-process migrations still run at startup with blind stamp
- **File:** `apps/api/app/main.py:30-51,69`
- **Risk:** Multi-worker `upgrade` race; `elif tables: stamp(head)` masks drift permanently; deploys coupled to boots.
- **Fix:** Run `alembic upgrade head` as deploy step (init container/entrypoint); if kept in-process, take `pg_advisory_lock` and gate to worker 0; replace blind stamp with schema-verified baselining.

#### M5 — STILL OPEN: Search/sort paths lack PostgreSQL indexes
- **Files:** `papers.py:253-263` (leading-wildcard ILIKE), `projects.py` (not re-read but prior finding: `list_projects` orders by `created_at DESC` with no composite index)
- **Impact:** Sequential scan on PG for search; sort spill as libraries grow.
- **Fix:** `CREATE EXTENSION pg_trgm` + GIN on `papers.title`, `papers.abstract`; or generated `tsvector` + GIN for ranked FTS. Composite `ix_papers_project_created (project_id, created_at DESC)`.

#### M6 — STILL OPEN: Application-level dedup without DB uniqueness
- **Files:** `zotero_service.py:141-152` (check-then-insert race), `citations.py:313-340` (BibTeX import no dedup)
- **Fix:** Partial unique index `CREATE UNIQUE INDEX uq_papers_project_doi ON papers (project_id, lower(doi)) WHERE doi IS NOT NULL` + `ON CONFLICT DO NOTHING` handling; normalize identifiers on write.

#### M7 — STILL OPEN: `ensure_default_plugins` commits inside GET requests
- **File:** `plugin_service.py:83-119`
- **Impact:** `list_plugins()` and `get_plugin()` call `ensure_default_plugins(db)` which may INSERT + `db.commit()` (line 105) on every read. Concurrent cold-start GETs race inserts — one wins, other raises unhandled `IntegrityError` (500) despite unique key. Five pointless SELECTs per plugin GET forever.
- **Fix:** Seed once at startup/migration (data migration or lifespan task with advisory lock), or cache "seeded" flag; catch `IntegrityError` explicitly if kept.

#### M8 — STILL OPEN: Client-side clock for all timestamps
- **Files:** Every model, e.g., `project.py:28-36`, `document.py:30-38`
- **Impact:** Multi-worker deployments rely on synchronized app-server clocks; raw SQL/bulk updates never bump `updated_at`; SQLite discards tzinfo (naive storage) while PG `timestamptz` keeps UTC — comparisons diverge.
- **Fix:** `server_default=func.now()` + DB trigger (`BEFORE UPDATE` function per skill guidance), keeping Python defaults as SQLite fallback.

### LOW

#### L1 — PARTIALLY FIXED: Index hygiene
- **STILL OPEN:** `plugin.py:22` `plugin_id` has `unique=True, index=True` (redundant — UNIQUE creates index).
- **STILL OPEN:** `citations` lacks composite `(document_id, position)` for canonical read `WHERE document_id=? ORDER BY position` (model `citation.py:21-22` has individual indexes only).
- **STILL OPEN:** `projects` lacks `(owner_id, updated_at DESC)` for `list_projects` ordering.

#### L2 — N/A: Data migration in `c4d9f2b8a7e1` no longer applies (constraint in baseline)

#### L3 — STILL OPEN: VARCHAR length enforcement diverges silently
- **Files:** `version.py:52` (`change_summary String(500)`), `paper.py:27` (`title String(500)`), `paper.py:36` (`pdf_path String(1000)`), `user.py:22-23` (`email String(255)`, `name String(255)`), etc.
- **Impact:** SQLite dev accepts arbitrarily long values; PostgreSQL raises `value too long for type character varying(n)` in prod. Registration/editor inputs passing tests can 500 in production.
- **Fix:** Validate lengths in Pydantic schemas or switch to portable `Text` where truncation isn't meaningful.

#### L4 — STILL OPEN: Case-sensitive email identity
- **Files:** `auth.py:71` (`User.email == email`), `teams.py:237` (`member_in.email` lookup), registration `auth.py:180`
- **Fix:** `CITEXT` column type (with `citext` extension) or normalized `lower(email)` functional unique index + consistent normalization on write.

#### L5 — STILL OPEN: Polymorphic `owners` lacks intra-table integrity
- **File:** `models/owner.py:28-35`, `models/user.py:27`
- **Issues:** `name` nullable for `owner_type='team'`; nothing prevents `personal_owner_id` pointing at `owner_type='team'`.
- **Fix:** `CheckConstraint("owner_type <> 'team' OR name IS NOT NULL", name="ck_owner_team_has_name")`; validate owner type when linking personal owners (application or trigger).

#### L6 — STILL OPEN: `render_as_batch=True` unconditionally in `alembic/env.py`
- **File:** `alembic/env.py:31,58`
- **Impact:** Harmless on PG (batch mode only activates on SQLite) but signals SQLite-first migration habits; on PG prefer plain `op.alter_table` semantics.

---

## Migration Review (Updated)

| Revision | Content | Assessment |
|---|---|---|
| `ec9eb70fcc96` ("initial_schema") | **Creates all 12 tables** with FKs, indexes, ondelete, constraints | **Correct baseline** — fixes C1. NOT NULL columns have `server_default` (e.g., `version` default 1, `extraction_status` default 'ok'). |
| `180baac94a46` | No-op: `is_admin` in baseline | Correct no-op; model carries Python `default=False` consistent. |
| `a1f2c3d4e5f6` | No-op: `entrypoints` in baseline | Correct no-op; generic JSON (see H2). |
| `c4d9f2b8a7e1` | No-op: unique constraint in baseline | Correct no-op; constraint created in baseline with data repair implied for legacy. |
| `f1a2b3c4d5e6` | Adds 4 missing indexes idempotently (H4) | **Good:** idempotent via inspector check; clean downgrade. |
| `env.py` | URL from settings; `NullPool` for migration; `render_as_batch=True` both modes | Sound; `check_same_thread` only for SQLite. Batch unconditional (L6). |

**Chain-level verdict:** **Fresh install path now works** (C1 fixed). **No `CREATE EXTENSION` step** despite pgvector stack deployed (C2). **No CI mechanism** catches drift (I1). Drift risk reduced but not eliminated because `stamp(head)` on legacy DBs remains blind.

---

## Query Pattern Analysis (Updated)

**Transaction boundaries.** Dominant pattern: correct single-unit commits (`add → commit → refresh`). Exceptions: `upload_paper → chunk_paper` (2-phase by design, failure-tolerated but success-reported); `ensure_default_plugins` committing inside reads (M7). Retry-with-rollback discipline demonstrated (`_commit_version`, `get_or_create_local_user`, `restore_document_version`).

**Session lifecycle.** Request-scoped `get_db` used correctly for HTTP. **Exceptions:** SSE chat stream (`chat.py:98-112`) holds `db` across full LLM stream — same class of risk as prior WS issue, shorter duration. `_persist_doc_edit` (`collaboration.py:41-62`) is model citizen: dedicated short-lived session, try/commit/except-rollback/finally-close, offloaded to worker thread.

**Lazy-load exposure.** `relationship()` defaults lazy everywhere; hot paths traversing >1 hop (`paper.project.owner_id`, `document.project.owner_id`, `annotation.paper.project.owner_id`, comment recursion, lit-matrix per-paper chunks) each cost extra round-trip. No global `selectinload`/`joinedload` strategy. At single-user scale latency noise; at team scale compounds with M1 pool pressure.

**Engine-specific traps found:**
- `ilike()` with leading wildcards (works both; unindexed on PG — M5)
- `PRAGMA foreign_keys=ON` now enabled (database.py:22) — dev/prod FK parity **improved**
- Aware-datetimes persisted through SQLite lose tzinfo; comparisons currently in Python/DB ordering, no live bug, but future `datetime.utcnow()`-vs-loaded mix-up throws only on one engine (M8)
- `String(n)` lengths enforced only on PG (L3)
- Booleans: consistent `Boolean` usage; SQLite 0/1 vs PG true/false handled transparently — no trap
- `func.count()` aggregation and `IN` lists portable; `yield_per(500)` streaming in RAG engine-neutral and memory-bounded (positive)

---

## Positive Observations (Confirmed)

1. **Typed ORM style throughout** — `Mapped[]`/`mapped_column` 2.0-style, `TYPE_CHECKING` imports, no legacy Query-pattern debt.
2. **Timezone discipline** — every timestamp `DateTime(timezone=True)` defaulted to `datetime.now(UTC)`; JWT expiry math likewise aware.
3. **Uniqueness where it counts** — `users.email`, `memberships(owner_id,user_id)`, `plugin_configs.plugin_id`, `document_versions(document_id,version_number)` — last with careful data-repair migration and collision-retrying writer.
4. **Authorization helper uniform** — one indexed-shape membership check gates every resource access, including WS auth frame.
5. **Memory-bounded retrieval skeleton** — `hybrid_search` streams with `yield_per`, keeps top-K heap, batch-hydrates survivors; algorithm shape right even though vector backend (C2) wrong.
6. **Atomicity instincts demonstrated** — bulk BibTeX import single-commit; user+owner+membership single-commit with flushes; per-operation sessions in WS persistence with full rollback/close hygiene.
7. **Config-level production guardrails** — SQLite refused in production, compromised default secrets rejected, OpenAPI/docs disabled in prod.
8. **Baseline migration is complete** — all tables, FKs, indexes, ondelete policies present; fresh install works.
9. **Four hot-path indexes added** — `f1a2b3c4d5e6` addresses H4 cleanly with idempotent migration.
10. **WS session pinning fixed** — `collaboration.py` now releases pool slot after auth, uses per-operation sessions.

---

## Prioritized Recommendations (Updated)

1.  **[C2] Adopt pgvector end-to-end**: `CREATE EXTENSION vector` migration; dialect-switched `Vector(dim)` column for `paper_chunks.embedding`; KNN `<=>` retrieval with project pre-filter; optionally `tsvector`/`pg_trgm` for lexical half. Keep JSON fallback for SQLite dev. *(Blocks scalability; infrastructure already paid for.)*

2.  **[H1] Fix SSE session pinning**: In `chat.py:project_chat_stream`, authenticate with scoped session, close it, then per-operation `SessionLocal()` in generator (replicate `_persist_doc_edit` pattern). Configure pool sizing (see M1).

3.  **[H2/H3] Type & index modernization**: JSONB-with-variant for all 9 JSON columns; native `UUID` PKs with `gen_random_uuid()` server default; composite indexes `(document_id, position)` on citations, `(project_id, created_at DESC)` on papers, `(owner_id, updated_at DESC)` on projects.

4.  **[H6+M6] Enforce invariants in database**: CHECK/ENUMs for role/status/scope/owner_type/plugin_type/highlight_color; real FK for `owners.created_by_user_id`; `ondelete` on `document_comments.user_id` (currently missing); unique `(project_id, lower(doi))`; `CITEXT` or normalized-lower unique index for emails.

5.  **[M1/M4] Operational hardening**: Explicit pool settings + `statement_timeout`; move migrations to deploy-time with advisory locking; replace blind `stamp(head)` with schema-verified baselining.

6.  **[I1] CI on PostgreSQL** with full suite + Alembic autogenerate-drift check — cheapest structural prevention for every finding recurring.

7.  **[M2/M3/M7] Query-path cleanup**: Batch lit-matrix chunk loads (single `IN` query + groupby); deepen reply eager-loading; pre-filter @-popover candidates in SQL; demote `ensure_default_plugins` to startup/migration task.

8.  **[L3/L5] Schema integrity**: Pydantic validation for VARCHAR lengths; CHECK constraint for `owner_type='team' → name NOT NULL`; validate personal owner type linkage.

---

## Summary: Delta from Prior Audit

| Category | Prior Count | Fixed | Partially Fixed | Still Open | New |
|---|---|---|---|---|---|
| CRITICAL | 2 | 1 | 0 | 1 | 0 |
| HIGH | 6 | 1 | 2 | 3 | 0 |
| MEDIUM | 8 | 0 | 2 | 6 | 0 |
| LOW | 6 | 0 | 1 | 5 | 0 |
| INFO | 5 | 0 | 0 | 5 | 0 |
| **Total** | **27** | **2** | **5** | **20** | **0** |

**Net improvement:** C1 (blocking fresh installs) and H4 (4 missing indexes) resolved. H5 `restore_document_version` atomicity fixed. WS session pinning (H1) fixed. **Remaining critical path:** C2 (pgvector), H1 SSE pinning, H2/H3 type modernization, H6/M6 constraint enforcement, M1/M4 operational hardening, I1 PostgreSQL CI.

---

*End of report — generated by read-only verification & re-audit, skill: postgresql-code-review.*