# PostgreSQL Code Review — OpenResearch Data Layer Audit

**Audit ID:** 08-postgresql-code-review
**Scope:** `apps/api` data layer — SQLAlchemy models (`app/models/**`), Alembic migrations (`alembic/versions/**`), session/engine setup (`app/core/database.py`, `app/core/config.py`), and query/transaction patterns in services & API endpoints.
**Mode:** READ-ONLY audit. No files were modified.
**Date:** 2026-08-26

---

## Scope & Methodology

Applied the **postgresql-code-review** skill as an audit-only review over the persistence layer. Every file in `app/models/` (12 model modules) and `alembic/versions/` (4 revisions + `env.py`) was read in full, cross-checked against each other for drift, and traced into consumer code:

| Area | Files examined |
|---|---|
| Models | `app/models/{__init__,owner,user,membership,project,document,paper,citation,annotation,chunk,comment,version,plugin}.py` |
| Migrations | `ec9eb70fcc96_initial_schema.py`, `180baac94a46_add_users_is_admin.py`, `a1f2c3d4e5f6_add_plugin_configs_entrypoints.py`, `c4d9f2b8a7e1_document_versions_unique_number.py`, `alembic/env.py` |
| Engine/session | `app/core/database.py`, `app/core/config.py`, `app/main.py` (`_run_migrations`), `tests/conftest.py`, `.env.example`, `infrastructure/docker-compose.yml`, `pyproject.toml` |
| Query patterns | Endpoints: `papers.py`, `documents.py`, `projects.py`, `teams.py`, `comments.py`, `citations.py`, `version_history.py`, `collaboration.py`, `chat.py`, `research.py`; Services: `auth.py`, `rag_service.py`, `intelligence_service.py`, `zotero_service.py`, `plugin_service.py` |

Checks applied: PostgreSQL type correctness (JSONB vs JSON, arrays, UUID, TIMESTAMPTZ, CITEXT/ENUM/DOMAIN usage), indexing strategy (FK indexes, composite indexes for actual filters/sorts, GIN/trgm opportunities), constraint quality (NULLability, UNIQUE, CHECK, on-delete), N+1 detection (lazy loads inside loops), transaction boundaries (multi-step commits, partial-write windows), session lifecycle (WebSocket/SSE pinning), SQLite↔PostgreSQL portability traps (pragmas, ILIKE, datetime tz, boolean, varchar length enforcement), migration hygiene (downgrade, data safety, model↔migration drift), pooling configuration, and declared-vs-used extension features (pgvector).

---

## Executive Summary

The data layer is cleanly written at the ORM level (typed `Mapped[]` columns, timezone-aware timestamps, sensible unique constraints, several deliberate N+1 counter-measures), **but it is not yet a production PostgreSQL data layer**. Two defects dominate:

1. **The Alembic chain cannot create the schema.** The revision named `initial_schema` contains *no table creation* — only an `ADD COLUMN`. A fresh database (dev SQLite file **or** production Postgres) fails at startup because `main.py:_run_migrations()` runs `upgrade head` against an empty database, altering a nonexistent `documents` table. Existing databases are masked by a blanket `stamp head`.
2. **pgvector is declared everywhere and used nowhere.** It appears in `pyproject.toml`, `requirements*.txt`, and the Docker image (`pgvector/pgvector:pg16`), yet embeddings live in a generic `JSON` column and `hybrid_search` streams *every* chunk row through Python to compute cosine similarity — an O(N) full-scan-per-query design that will not survive real library sizes.

Secondary themes: generic `sa.JSON` instead of JSONB, `String(36)` UUID primary keys instead of native `UUID`, missing FK/composite indexes, free-text status/role columns with zero CHECK/ENUM constraints, non-atomic multi-commit write flows, WebSocket/SSE handlers pinning pooled sessions, and a test suite that exercises `create_all` on SQLite only — meaning migrations and PostgreSQL behavior are effectively untested.

### Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 6 |
| MEDIUM | 8 |
| LOW | 6 |
| INFO | 5 |
| **Total findings** | **27** |

---

## Schema Inventory

12 tables. All PKs are Python-generated `uuid4()` stored as `String(36)`. All timestamps are `DateTime(timezone=True)` with client-side `datetime.now(timezone.utc)` defaults. All JSON columns are generic `sa.JSON`.

| Table | Key columns | Indexes | Constraints | Notable gaps |
|---|---|---|---|---|
| `owners` | id PK, owner_type `Str(20)` def `'user'`, name NULL, description NULL, created_by_user_id `Str(36)` (no FK) | PK only | — | No CHECK on `owner_type`; `created_by_user_id` dangling ref; no index on `created_by_user_id` |
| `users` | id PK, email `Str(255)` UQ+idx, hashed_password, name, is_admin bool, personal_owner_id `Str(36)` FK→owners.id UQ, created_at | email idx, personal_owner_id (via UNIQUE) | UNIQUE(email), UNIQUE(personal_owner_id) | No ondelete on personal_owner_id; no CHECK tying personal owner to `owner_type='user'` |
| `memberships` | id PK, owner_id FK→owners.id, user_id FK→users.id, role `Str(20)` def `'owner'`, created_at | PK only + UNIQUE(owner_id,user_id) | UNIQUE(owner_id,user_id) | **No index on `user_id` alone** (hot lookup path); role free-text; no ondelete on either FK |
| `projects` | id PK, owner_id FK→owners.id (idx), name, description, created_at, updated_at | owner_id idx | — | No ondelete; no composite (owner_id, updated_at) for the default sort |
| `documents` | id PK, project_id FK→projects.id (idx), title def, content_json JSON, plain_text Text, version int, created_at, updated_at | project_id idx | — | No ondelete; content_json generic JSON |
| `papers` | id PK, project_id FK (idx), title Str(500), authors JSON, abstract Text, doi/arxiv_id `Str(255)` idx, pmid (no idx), year int, pdf_path Str(1000), metadata_json JSON, extraction_status `Str(50)` def `'ok'`, created_at, updated_at | project_id, doi, arxiv_id idx | — | **pmid unindexed**; no UNIQUE(project_id, doi); extraction_status free-text; authors array-in-JSON |
| `citations` | id PK, document_id FK (idx), paper_id FK (idx), position int, citation_style Str(50), attribution_scope Str(20), page_number, relevant_passage Text, created_at | document_id, paper_id idx | — | No ondelete; attribution_scope/citation_style free-text; no composite (document_id, position) |
| `paper_annotations` | id PK, paper_id FK (idx), user_id FK (idx), page_number, selected_text Text NN, highlight_color Str(50), note_text, ai_thread JSON, position_data JSON, created_at, updated_at | paper_id, user_id idx | — | No ondelete either FK; ai_thread is message-array-in-JSON |
| `paper_chunks` | id PK, paper_id FK (idx), project_id FK (idx), page_number, section Str(255), paragraph, content Text NN, **embedding JSON**, metadata_json JSON, created_at | paper_id, project_id idx | — | Embedding as JSON (should be `vector`); no ondelete; metadata duplicated denormalized |
| `document_comments` | id PK, document_id FK **ondelete CASCADE** (idx), user_id FK (no idx), author_name, parent_id self-FK **ondelete CASCADE** (idx), selected_text, from_pos/to_pos int NULL, content Text NN, resolved bool, created_at, updated_at | document_id, parent_id idx | — | Only table pair with explicit ondelete; user_id unindexed |
| `document_versions` | id PK, document_id FK **ondelete CASCADE** (idx), version_number int, user_id FK NULL (no idx), author_name, title, content_json JSON, plain_text, change_summary Str(500), created_at | document_id idx | UNIQUE(document_id,version_number) | user_id unindexed; uniqueness added in migration `c4d9f2b8a7e1` with data repair |
| `plugin_configs` | id PK, plugin_id Str(100) **UQ + idx (redundant)**, name, version, plugin_type Str(50), description, author, license, enabled bool, config_json JSON, entrypoints JSON, created_at, updated_at | plugin_id idx (duplicate of UNIQUE) | UNIQUE(plugin_id) | plugin_type free-text; entrypoints added by migration `a1f2c3d4e5f6` |

Declared dependency vs. reality: `psycopg2-binary` + `pgvector>=0.2.5` (`pyproject.toml:26-30`), `pgvector/pgvector:pg16` container (`infrastructure/docker-compose.yml:5`) — **zero** `Vector` columns, zero `CREATE EXTENSION vector`, zero pgvector imports anywhere in `app/`.

---

## Detailed Findings

### CRITICAL

#### C1 — Migration chain cannot bootstrap the schema; fresh installs crash at startup
- **Files:** `apps/api/alembic/versions/ec9eb70fcc96_initial_schema.py:21-35`, `app/main.py:31-39`
- **Snippet:**
  ```python
  # ec9eb70fcc96 "initial_schema" — the ENTIRE upgrade():
  with op.batch_alter_table('documents', schema=None) as batch_op:
      batch_op.add_column(sa.Column('version', sa.Integer(), nullable=False))
  ```
  ```python
  # main.py
  inspector = inspect(engine)
  tables = set(inspector.get_table_names())
  if "alembic_version" in tables:
      command.upgrade(alembic_cfg, "head")
  elif tables:
      command.stamp(alembic_cfg, "head")     # blanket stamp, no verification
  else:
      command.upgrade(alembic_cfg, "head")   # empty DB -> alters nonexistent table
  ```
- **Impact:** The revision history contains exactly four revisions and **none creates any of the 12 tables** (the others add `users.is_admin`, `plugin_configs.entrypoints`, and the `document_versions` unique constraint). On a brand-new database — a fresh `openresearch_dev.db` or the production Postgres volume — `command.upgrade(cfg, "head")` executes `ALTER TABLE documents ADD COLUMN ...` against a nonexistent relation: SQLite raises `no such table: documents`; PostgreSQL raises `relation "documents" does not exist`. The FastAPI lifespan aborts; the service never boots. Conversely, any legacy DB created before Alembic (by the removed ad-hoc `create_all`) is silently stamped to `head` **without checking that its schema actually matches head** — if such a DB predates, say, `plugin_configs.entrypoints`, it is marked migrated and every subsequent plugin read hits `column does not exist` at request time.
- **Fix:** Add a genuine baseline migration creating all tables from `Base.metadata` (or hand-written DDL matching current models), chained below `ec9eb70fcc96` with proper `down_revision` rewiring; replace the blanket `stamp(head)` with a revision-aware baseline (inspect for expected columns/tables, stamp the oldest revision whose schema the DB provably matches, then `upgrade`). Add a CI smoke test: empty Postgres → `upgrade head` → app starts.

#### C2 — pgvector declared-but-unused; embeddings stored as JSON and scored in Python (O(N) scan per query)
- **Files:** `pyproject.toml:29,41`, `requirements.txt:9`, `requirements.lock:87`, `infrastructure/docker-compose.yml:5` vs `app/models/chunk.py:30`, `app/services/rag_service.py:354-433`
- **Snippet:**
  ```python
  # chunk.py:30
  # Embedding vector stored as JSON array of floats for cross-engine compatibility (SQLite & pgvector)
  embedding: Mapped[Optional[List[float]]] = mapped_column(JSON, nullable=True)
  ```
  ```python
  # rag_service.hybrid_search — streams EVERY chunk of the project:
  for row in db.execute(stmt).yield_per(500):
      sem_score = 0.0
      if row.embedding:
          sem_score = self.embedding_service.cosine_similarity(query_emb, row.embedding)
      ...
      if len(top_heap) < limit:
          heapq.heappush(top_heap, (hybrid_score, next(tie_breaker), candidate))
  ```
- **Impact:** Three costs compound: (1) each candidate row materializes a JSON array of hundreds-to-thousands of floats and parses it (JSON text → Python list) just to score it; (2) the scan is linear over the whole project's chunk count on *every* chat turn, autocomplete, ask-paper, and gap-analysis call; (3) the infrastructure pays for `pgvector/pgvector:pg16` and ships the `pgvector` package while getting none of IVFFlat/HNSW index acceleration. This is the single largest scalability ceiling in the codebase — retrieval latency grows linearly with corpus size and CPU-bound scoring happens inside request handling.
- **Fix:** On PostgreSQL, declare `embedding Vector(768)` (dimension per the configured embedding model) with `CREATE EXTENSION IF NOT EXISTS vector` in a migration, insert via bulk `COPY`, and retrieve with `<=>` KNN ordering + `pre_filter` on `project_id` (composite HNSW or filtered ivfflat). Keep the JSON column behind a dialect-switched type (`JSONB` variant / `Vector` variant) for SQLite dev. The lexical half of hybrid search can become Postgres FTS (`tsvector` + GIN) or `pg_trgm` similarity instead of Python substring loops.

### HIGH

#### H1 — WebSocket endpoint pins a pooled DB session for the socket's lifetime; sync lazy loads inside async context
- **File:** `app/api/v1/endpoints/collaboration.py:227-244` (endpoint), `:191,214-215` (lazy `document.project`)
- **Snippet:**
  ```python
  @router.websocket("/ws/collaborate/{document_id}")
  async def websocket_collaboration(
      websocket: WebSocket,
      document_id: str,
      db: Session = Depends(get_db),   # held until disconnect
  ):
  ```
- **Impact:** `get_db` yields a session whose connection stays checked out until the dependency exits — here, when the socket disconnects. With unconfigured defaults (`pool_size=5, max_overflow=10`), ~15 simultaneous collaboration sockets exhaust the pool and **block every HTTP request**, producing an app-wide outage triggered by ordinary collaborative editing. Additionally `_authenticate_websocket` performs sync ORM lazy loads (`document.project.owner_id`) directly on the event loop, stalling all concurrent requests during DB round-trips. The same long-hold pattern applies to SSE chat: `project_chat_stream` (`chat.py:70-114`) holds `db` open for the entire LLM streaming duration. The codebase already demonstrates the correct pattern in `_persist_doc_edit` (`collaboration.py:40-61`: short-lived `SessionLocal()` per operation, wrapped in `to_thread`).
- **Fix:** In WS/SSE handlers, resolve auth + access with a short-lived session, close it, and use per-operation `SessionLocal()` inside `anyio.to_thread` (as `_persist_doc_edit` does). Configure pool sizing explicitly (see M1).

#### H2 — Generic `sa.JSON` everywhere instead of PostgreSQL `JSONB`
- **Files (all 9 JSON columns):** `models/paper.py:25,32`, `models/chunk.py:30-31`, `models/document.py:23`, `models/version.py:44`, `models/annotation.py:28-33`, `models/plugin.py:30-31`
- **Snippet:** `metadata_json: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSON, nullable=True)`
- **Impact:** On PostgreSQL these compile to `json` (text), not `jsonb`: no containment operators (`@>`, `?`), no GIN index support, whitespace-preserved storage, and full-column rewrite on every update. Queries that will need this soon: filtering chunks by `metadata_json->>'extraction_status'`, plugins by `entrypoints` keys, annotations by `ai_thread` roles. Also blocks C2's fix path.
- **Fix:** Use a dialect-conditional type, e.g. `JSONB().with_variant(JSON, "sqlite")` (SQLAlchemy 2.0: `sqlalchemy.dialects.postgresql.JSONB`), and add GIN indexes where containment filters are planned.

#### H3 — UUID primary keys modeled as `String(36)` instead of native `UUID`
- **Files:** every model, e.g. `models/user.py:20`, `models/paper.py:22` (pattern ×12)
- **Snippet:** `id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))`
- **Impact:** 36-byte hex strings vs 16-byte `uuid` on PostgreSQL: larger PKs inflate every FK column and index; random string ordering degrades B-tree locality vs native uuid; no DB-side default (`gen_random_uuid()`) means raw-SQL inserts/backfills must synthesize IDs in Python. SQLite has no native UUID, so use `Uuid().with_variant(...)` or keep strings only under a SQLite variant.
- **Fix:** `from sqlalchemy import Uuid` → `id: Mapped[str] = mapped_column(Uuid(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))` on PG variants (requires `pgcrypto` or PG13+ built-in).

#### H4 — Missing indexes on hot FK/filter columns (PostgreSQL does not auto-index FKs)
- **Files/models:** `models/membership.py:27-28` + `__table_args__:34`; `models/comment.py:29`; `models/version.py:41`; `models/paper.py:29`
- **Snippets:**
  ```python
  owner_id: Mapped[str] = mapped_column(String(36), ForeignKey("owners.id"), nullable=False)
  user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
  __table_args__ = (UniqueConstraint("owner_id", "user_id", name="uq_owner_user_membership"),)
  ```
- **Impact:**
  - `memberships.user_id` is the lead predicate of `list_teams` (`teams.py:59`), `list_projects` (`projects.py:58`), and `verify_user_access_to_owner` fallback paths; the composite UNIQUE `(owner_id, user_id)` cannot serve `user_id`-leading scans → sequential scan on the authz/join hot path as memberships grow.
  - `document_comments.user_id` (author-filtered moderation queries) and `document_versions.user_id` unindexed.
  - `papers.pmid` unindexed while sibling identifiers `doi`/`arxiv_id` are indexed — inconsistent, and identifier resolution dedup will want it.
- **Fix:** `Index("ix_memberships_user_id", "user_id")` (+ same for comments/versions `user_id`, `papers.pmid`).

#### H5 — Non-atomic multi-commit write flows (partial-failure windows)
- **Files:** `app/api/v1/endpoints/teams.py:30-40` (team creation), `app/api/v1/endpoints/version_history.py:149-171` (restore), `app/api/v1/endpoints/papers.py:178-186` (upload → index)
- **Snippets:**
  ```python
  db.add(team_owner); db.commit(); db.refresh(team_owner)   # commit 1
  membership = Membership(owner_id=..., user_id=current_user.id, role="owner")
  db.add(membership); db.commit()                            # commit 2
  ```
- **Impact:**
  - **teams.create_team:** crash/rejection between commits strands an `Owner(owner_type='team')` with zero members — an unreachable, undeletable-through-API workspace.
  - **restore_document_version:** restores doc content (commit 1) then writes the restore checkpoint (commit 2). Failure after commit 1 yields a restored document with **no audit trail**, and — worse — the restore path **never increments `documents.version`** (contrast `update_document`, `documents.py:123`). Concurrent editors holding older versions pass the optimistic-lock check at `documents.py:110` and silently overwrite the restored state. This is a data-integrity defect, not just atomicity cosmetics.
  - **upload_paper:** paper committed before chunk indexing; a failure leaves a searchable-less paper (logged and arguably accepted design, but the API response reports success with `extraction_status='ok'` regardless).
- **Fix:** Wrap related writes in a single transaction (one `commit` after all adds; rely on `flush()` for generated IDs — the pattern already proven in `services/auth.py:create_user_with_personal_owner:141-161`). For restore: bump `doc.version += 1` and persist doc+checkpoint atomically.

#### H6 — Constraint quality: zero CHECK/ENUM constraints, dangling references, missing on-delete policy, SQLite FK enforcement off
- **Files:** all models (representative: `models/owner.py:28-31`, `models/membership.py:29`, `models/paper.py:35`, `models/citation.py:24,27`, `models/plugin.py:23-25`); `app/core/database.py:11-19`
- **Snippets:**
  ```python
  role: Mapped[str] = mapped_column(String(20), nullable=False, default="owner")   # 'owner'|'editor'|'viewer'
  created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=True)       # not a FK at all
  ```
  ```python
  cursor.execute("PRAGMA journal_mode=WAL")
  cursor.execute("PRAGMA synchronous=NORMAL")
  cursor.execute("PRAGMA busy_timeout=5000")   # foreign_keys=ON is MISSING
  ```
- **Impact:**
  - Enumerated values (`owner_type`, `role`, `extraction_status`, `attribution_scope`, `citation_style`, `plugin_type`, `highlight_color`) are free text: typos and invalid states persist silently and branch logic downstream (`required_roles=["owner","editor"]`) simply denies access — painful to debug.
  - `owners.created_by_user_id` references nothing; deleting/renaming users leaves dangling pointers.
  - Apart from `document_comments`, **no FK declares `ondelete`**. Deletes work today only because ORM-level `cascade="all, delete-orphan"` fires on session-mediated deletes; bulk deletes, raw SQL, or future non-ORM maintenance scripts will hit FK violations (PG) or strand orphans (SQLite).
  - Dev SQLite never enables `PRAGMA foreign_keys=ON`, so FK violations and cascade behavior diverge between dev and prod — bugs invisible locally appear in PostgreSQL.
- **Fix:** Add `CheckConstraint` (portable) or PG `ENUM` types for closed value sets; make `created_by_user_id` a real FK; choose an explicit on-delete policy per FK (`CASCADE` for owned children like `paper_chunks.paper_id`, `SET NULL` for soft refs like `document_versions.user_id`); add `cursor.execute("PRAGMA foreign_keys=ON")` to the SQLite connect hook.

### MEDIUM

#### M1 — Connection pooling unconfigured for the PostgreSQL production target
- **File:** `app/core/database.py:9`
- **Snippet:** `engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)`
- **Impact:** Defaults (`pool_size=5`, `max_overflow=10`, no `pool_recycle`, no `pool_timeout`) combined with H1's session pinning and SSE long-holds make pool starvation likely under modest concurrency; no recycle means cloud LBs/pgbouncer idle kills surface as sporadic errors between `pre_ping` intervals; no `statement_timeout` lets a runaway Python-scored RAG query hold connections indefinitely. `pool_pre_ping=True` is present — good — but is not sufficient alone.
- **Fix:** Settings-driven `pool_size`, `max_overflow`, `pool_recycle=1800`, `pool_timeout`, and PG `connect_args={"options": "-c statement_timeout=15000"}` (plus `application_name`).

#### M2 — N+1 query patterns in services
- **Files:** `app/services/intelligence_service.py:409-419`; `app/api/v1/endpoints/comments.py:34-50,67-76`; `app/services/zotero_service.py:116-126`; ubiquitous `x.project.owner_id` lazy chains
- **Snippets:**
  ```python
  for paper in papers:                      # lit-matrix: 1 chunk query PER paper
      chunks = (
          db.query(PaperChunk)
          .filter(PaperChunk.paper_id == paper.id)
          .order_by(PaperChunk.page_number.asc(), PaperChunk.paragraph.asc())
          .all()
      )
  ```
  ```python
  # comments: joinedload is ONE level deep; recursion lazy-loads deeper levels
  .options(joinedload(DocumentComment.replies))
  ...
  def _build_comment_response(c): return ...(replies=[_build_comment_response(r) for r in (c.replies or [])])
  ```
- **Impact:** Literature matrix issues P+1 queries (P = papers analyzed); threaded replies beyond depth 1 trigger per-node lazy loads (replies-of-replies are creatable via the reply endpoint); Zotero sync runs 2 dedup SELECTs per item; nearly every endpoint walks `obj.project.owner_id` (one extra query per request — tolerable individually, but multiplied across ~20 endpoints and the per-request membership check).
- **Fix:** Batch chunk fetch with `PaperChunk.paper_id.in_(ids)` + `groupby`; `joinedload(DocumentComment.replies).joinedload(DocumentComment.replies)` or selectinload for trees; preload Zotero dedup keys with two set-building queries before the loop; consider `joinedload(Project.owner)` where ownership is always checked.

#### M3 — Whole-library Python scoring in request path
- **Files:** `app/api/v1/endpoints/citations.py:489-543` (`rank_citations_for_context`), `app/services/graph_service.py:38,194`, `app/api/v1/endpoints/citations.py:430` (export)
- **Snippet:** `papers = db.query(Paper).filter(Paper.project_id == document.project_id).all()` then per-paper keyword scoring in Python.
- **Impact:** The @-popover ranking loads and JSON-decodes `authors` for every project paper per keystroke-triggered request; graph building and BibTeX export do full-library loads. Fine at dozens of papers; degrades linearly and holds rows/connections longer than needed.
- **Fix:** Pre-filter candidates in SQL (`title ILIKE ANY`, year equality, trigram similarity) before Python scoring; paginate exports; move ranking thresholds into the query where possible.

#### M4 — In-process startup migrations: multi-worker race + unverified baseline stamp
- **File:** `app/main.py:21-39,56`
- **Snippet:** `def _run_migrations(): ... command.stamp(alembic_cfg, "head")` / `command.upgrade(alembic_cfg, "head")` called from `lifespan`.
- **Impact:** Under `uvicorn --workers N` (or gunicorn), N processes race Alembic against one database — concurrent `upgrade` can deadlock or double-apply DDL; the `elif tables: stamp(head)` branch marks legacy DBs migrated without comparing their schema to head (masks drift permanently; interacts with C1). Also couples deploys to boots, so a rollback boot can silently migrate forward.
- **Fix:** Run `alembic upgrade head` as a deploy step (init container/entrypoint), take `pg_advisory_lock(…)` around it if kept in-process, gate to worker 0, and replace blind stamp with schema-verified baselining.

#### M5 — Search/sort paths lack supporting PostgreSQL indexes
- **File:** `app/api/v1/endpoints/papers.py:232-244`; `models/paper.py:37-45`
- **Snippet:**
  ```python
  search_term = f"%{q.strip().lower()}%"
  query = query.filter((Paper.title.ilike(search_term)) | (Paper.abstract.ilike(search_term)) | ...)
  papers = query.order_by(Paper.created_at.desc()).offset(skip).limit(limit).all()
  ```
- **Impact:** Leading-wildcard `ILIKE` on `title`/`abstract` (Text) is a guaranteed sequential scan on PG; the default listing sort `project_id = ? ORDER BY created_at DESC LIMIT/OFFSET` has no composite `(project_id, created_at)` index → sort spills as libraries grow. The manual `.lower()` is redundant with `ilike`.
- **Fix:** `pg_trgm` extension + GIN indexes on `title`, `abstract` (or a generated `tsvector` column with GIN for ranked FTS); composite `ix_papers_project_created (project_id, created_at DESC)`; drop the redundant `.lower()`.

#### M6 — Application-level dedup without DB uniqueness (duplicate-prone imports)
- **Files:** `app/services/zotero_service.py:116-126`; `app/api/v1/endpoints/citations.py:318-413` (BibTeX import performs no dedup at all)
- **Snippet:** `existing = db.query(Paper).filter(Paper.project_id == project_id, Paper.doi == doi).first()`
- **Impact:** Check-then-insert races (two concurrent imports) and the completely unchecked BibTeX importer produce duplicate papers; DOI comparison is exact-case (DOIs are case-insensitive by convention). Nothing at the schema level defends the invariant.
- **Fix:** Partial unique index `CREATE UNIQUE INDEX uq_papers_project_doi ON papers (project_id, lower(doi)) WHERE doi IS NOT NULL` + `ON CONFLICT DO NOTHING`/IntegrityError handling; normalize identifiers on write.

#### M7 — Write-on-read: `ensure_default_plugins` commits inside GET requests
- **File:** `app/services/plugin_service.py:80-114`
- **Snippet:** `list_plugins()`/`get_plugin()` call `ensure_default_plugins(db)` which SELECTs 5 rows and may INSERT+`db.commit()` — on every read.
- **Impact:** Read endpoints take write locks and mutate state; concurrent cold-start GETs can both see "missing" and race inserts — one wins, the other surfaces an unhandled `IntegrityError` (500) despite the `plugin_id` unique key protecting the data. Five pointless SELECTs per plugin GET forever.
- **Fix:** Seed once at startup/migration (data migration or lifespan task with advisory lock), or cache a "seeded" flag; catch `IntegrityError` explicitly if kept.

#### M8 — Client-side clock for all timestamps; `onupdate` misses non-ORM writes
- **Files:** every model, e.g. `models/project.py:26-34`; contrast `main.py` middleware using server time nowhere
- **Snippet:** `default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)`
- **Impact:** Multi-worker deployments rely on synchronized app-server clocks; raw SQL/bulk updates never bump `updated_at`, breaking "recently edited" ordering (`documents.py:69` sorts by it). SQLite additionally discards the tzinfo (naive storage) while PG `timestamptz` keeps UTC — comparisons mixing loaded values with new aware datetimes behave differently across engines.
- **Fix:** `server_default=func.now()` + `server_onupdate`/DB trigger (`moddatetime` or `BEFORE UPDATE` function per skill guidance), keeping the Python defaults as fallbacks for SQLite.

### LOW

#### L1 — Index hygiene nits
- `PluginConfig.plugin_id` declares `unique=True, index=True` (`models/plugin.py:20`) — the UNIQUE already creates the index; drop the duplicate.
- `citations` lacks composite `(document_id, position)` although the canonical read is `WHERE document_id=? ORDER BY position` (`citations.py:127-135`).
- `projects` lacks `(owner_id, updated_at DESC)` for `list_projects` ordering (`projects.py:63-65`).

#### L2 — Data migration quality in `c4d9f2b8a7e1`
- **File:** `alembic/versions/c4d9f2b8a7e1_document_versions_unique_number.py:25-59`
- Row-at-a-time `UPDATE`s with a per-group `MAX(version_number)` subquery (N+1-shaped, but bounded by duplicate count); runs in the implicit migration transaction (fine on PG). **Downgrade** drops the constraint but does not restore original duplicate numbering — acceptable and documented, worth a comment. Good practice overall: dedupe-before-constrain is the right shape.

#### L3 — VARCHAR length enforcement diverges silently (SQLite ignores lengths)
- **Files:** e.g. `models/version.py:46` (`change_summary String(500)`), `models/paper.py:24` (`title String(500)`), `models/user.py:22-23`
- SQLite dev accepts arbitrarily long values; PostgreSQL raises `value too long for type character varying(n)` in prod. Registration/editor inputs that pass tests can 500 in production. Either validate lengths in Pydantic schemas or switch to portable `Text` where truncation isn't meaningful.

#### L4 — Case-sensitive email identity
- **Files:** `app/services/auth.py:63` (`User.email == email`), `teams.py:206` (`member_in.email` lookup), registration path `auth.py:59`
- PG compares case-sensitively; `User@Example.com` vs `user@example.com` are different accounts locally and in prod. Skill-preferred fix: `CITEXT` column type (with `citext` extension) or a normalized `lower(email)` functional unique index + consistent normalization on write.

#### L5 — Polymorphic `owners` lacks intra-table integrity
- **File:** `models/owner.py:28-31`; `models/user.py:27`
- `name` is nullable even when `owner_type='team'` (teams are displayable via `name or "Untitled Team"` fallbacks — silent degenerate state); nothing prevents a `personal_owner_id` pointing at `owner_type='team'`. Add `CHECK ((owner_type <> 'team') OR (name IS NOT NULL))` and validate owner type when linking personal owners.

#### L6 — `render_as_batch=True` unconditionally in `alembic/env.py`
- **File:** `alembic/env.py:31,56`
- Harmless on PostgreSQL (batch mode only activates on SQLite) but signals SQLite-first migration habits; on PG prefer plain `op.alter_table` semantics and reserve `render_as_batch` for the SQLite variant to avoid masking operations that PG could do online.

### INFO

#### I1 — Test suite cannot catch migration or PostgreSQL-specific failures
- **File:** `tests/conftest.py:19-20,55`
- All fixtures run `Base.metadata.create_all` on `sqlite:///:memory:` with `StaticPool`. Consequences: the Alembic chain is never executed in CI (C1 went unnoticed), and engine-divergent behaviors (ILIKE lowering, JSON vs JSONB, tz handling, FK enforcement, varchar limits) are structurally invisible. Recommend a CI matrix job against a `postgres:16` service container running the suite via `DATABASE_URL`, plus an Alembic autogenerate diff check (empty `upgrade head` → `autogen-check` produces no diff) to catch model↔migration drift.

#### I2 — Positive: several deliberate N+1 countermeasures exist
- `teams.list_teams` aggregates member counts with one `GROUP BY` (`teams.py:66-73`, annotated "§3.3"); `rag_service.hybrid_search` hydrates surviving candidates with a single batched `IN` query (`rag_service.py:440-445`); comments/citations listings use `joinedload` for their first association (`comments.py:69`, `citations.py:129`); BibTeX import batches all adds behind one commit (`citations.py:403-408`).

#### I3 — Positive: transactional primitives are mostly sound
- `create_user_with_personal_owner` uses flush-ordering with a single terminal commit (`auth.py:141-161`); `get_or_create_local_user` handles concurrent-create via commit/rollback/re-query (`auth.py:95-103`); `_commit_version` retries `MAX+1` allocation collisions against the unique constraint with bounded retries (`version_history.py:36-49`).

#### I4 — Production guardrails exist at config level
- `config.py:105-109` refuses SQLite `DATABASE_URL` when `ENVIRONMENT=production`; secret-key validation blocks known-default secrets. (Data-layer relevant: the guard implies Postgres is mandatory, which sharpens C1/C2/M1.)

#### I5 — Row Level Security not applicable today, note for hosted mode
- Authorization is uniformly application-layer (`verify_user_access_to_owner` on every handler). Acceptable for the local-first product; if a shared-hosting tier ever lands, PG RLS keyed on `current_setting('app.current_user_id')` would be the defense-in-depth upgrade path (per skill checklist).

---

## Migration Review

| Revision | Content | Assessment |
|---|---|---|
| `ec9eb70fcc96` ("initial_schema") | Adds `documents.version` INTEGER NOT NULL (batch mode) | **Misnomer — creates nothing.** Root cause of C1. Also adds a NOT NULL column with no `server_default`; on a large existing `documents` table PG rewrites the table under ACCESS EXCLUSIVE lock (fine at current scale, risky habit). |
| `180baac94a46` | Adds `users.is_admin` BOOLEAN NOT NULL `server_default=sa.false()` | Correct pattern: server-side default backfills existing rows; downgrade clean. Model carries Python-side `default=False` too — consistent. |
| `a1f2c3d4e5f6` | Adds `plugin_configs.entrypoints` JSON nullable | Matches model; nullable so safe. Generic JSON again (see H2). Clean downgrade. |
| `c4d9f2b8a7e1` | Dedupes `document_versions` numbering then adds UNIQUE(document_id, version_number) | Best migration in the set: real data migration with repair logic before constraining; bounded retries documented in the endpoint that depends on it. Minor: per-duplicate `MAX()` subquery; downgrade doesn't re-break numbering (fine). |
| `env.py` | URL injected from settings; `NullPool` for migration engine; `render_as_batch=True` both modes | Sound; `check_same_thread` only for SQLite. Batch rendering unconditional (L6). |

**Chain-level verdict:** There is **no path from empty database to working schema** (C1), no `CREATE EXTENSION` step despite the pgvector stack being deployed (C2), and no mechanism in CI that would notice either (I1). Drift risk is currently absolute because the models were clearly authored ahead of the migrations (models contain `document_comments` and `document_versions` with ondelete CASCADEs and unique constraints that exist in *some* migrations, while base tables exist in *none*).

---

## Query Pattern Analysis

**Transaction boundaries.** Dominant pattern is correct single-unit commits (`add → commit → refresh`) per endpoint. Violations: `teams.create_team` (2 commits), `restore_document_version` (2 commits + missed version bump — the worst offender, H5), `upload_paper → chunk_paper` (2-phase by design, failure-tolerated but success-reported), and `ensure_default_plugins` committing inside reads (M7). Retry-with-rollback discipline is demonstrably understood (`_commit_version`, `get_or_create_local_user`).

**Session lifecycle.** Request-scoped `get_db` is used pervasively and correctly for HTTP. Exceptions: the collaboration WebSocket (H1) and the SSE chat stream (`chat.py:98-108`, closure holds `db` across the whole LLM stream — same class of risk, shorter duration). `_persist_doc_edit` is the model citizen: dedicated short-lived session, try/commit/except-rollback/finally-close, offloaded to a worker thread.

**Lazy-load exposure.** `relationship()` defaults are lazy everywhere; hot paths that traverse more than one hop (`paper.project.owner_id`, `document.project.owner_id`, `annotation.paper.project.owner_id`, comment recursion, lit-matrix per-paper chunks) each cost one extra round-trip. No `selectinload`/`joinedload` strategy is configured globally (`SessionLocal` has `autoflush=False` only). At current single-user scale this is latency noise; at team scale it compounds with M1's pool pressure.

**Engine-specific traps found.**
- `ilike()` with leading wildcards (works both engines; unindexed on PG — M5).
- `PRAGMA foreign_keys` never enabled (dev/prod FK divergence — H6).
- Aware-datetimes persisted through SQLite lose tzinfo; all comparisons currently happen in Python or DB-side ordering, so no live bug, but any future `datetime.utcnow()`-vs-loaded mix-up will throw only on one engine (M8 note).
- `String(n)` lengths enforced only on PG (L3).
- Booleans: consistent `Boolean` usage; SQLite 0/1 vs PG true/false handled transparently by SQLAlchemy — no trap.
- `func.count()` aggregation and `IN` lists used portably; `yield_per(500)` streaming in RAG is engine-neutral and memory-bounded (positive).

---

## Positive Observations

1. **Typed ORM style throughout** — `Mapped[]`/`mapped_column` 2.0-style declarations, `TYPE_CHECKING` relationship imports, no legacy Query-pattern debt in models.
2. **Timezone discipline** — every timestamp is `DateTime(timezone=True)` defaulted to `datetime.now(timezone.utc)`; JWT expiry math likewise aware.
3. **Uniqueness where it counts** — `users.email`, `memberships(owner_id,user_id)`, `plugin_configs.plugin_id`, `document_versions(document_id,version_number)` — the latter with a genuinely careful data-repair migration and collision-retrying writer.
4. **Authorization helper is uniform** — one indexed-shape membership check gates every resource access, including the WebSocket auth frame.
5. **Memory-bounded retrieval skeleton** — `hybrid_search` streams with `yield_per`, keeps a top-K heap, and batch-hydrates only survivors; the algorithm shape is right even though the vector backend (C2) is wrong.
6. **Atomicity instincts demonstrated** — bulk BibTeX import single-commit; user+owner+membership single-commit with flushes; per-operation sessions in WS persistence with full rollback/close hygiene.
7. **Config-level production guardrails** — SQLite refused in production, compromised default secrets rejected, OpenAPI/docs disabled in prod.
8. **Prior audits corroborated** — `audit-reports/06-fastapi.md` independently flagged the WS session-pinning and migration-stamping issues; this audit confirms both at the data-layer level and adds the missing-schema root cause beneath them.

---

## Prioritized Recommendations

1. **[C1] Author a real baseline migration** creating all 12 tables (hand-written DDL or autogenerated against an empty DB), rewire `down_revision` chain, and replace `stamp(head)` with schema-verified baselining. Add CI: empty Postgres → `upgrade head` → boot check. *(Blocks every fresh install, dev and prod.)*
2. **[C2] Adopt pgvector end-to-end**: `CREATE EXTENSION vector` migration; dialect-switched `Vector(dim)` column for `paper_chunks.embedding`; KNN `<=>` retrieval with project pre-filter; optionally `tsvector`/`pg_trgm` for the lexical half. Keep JSON fallback for SQLite dev.
3. **[H1] Stop pinning sessions in WS/SSE**: authenticate with a scoped session, close it, then per-operation `SessionLocal()` in `to_thread` (replicate `_persist_doc_edit`).
4. **[H5] Make multi-step writes atomic** — especially `restore_document_version`: single transaction **and increment `documents.version`** to close the optimistic-lock bypass.
5. **[H6+M6] Enforce invariants in the database**: CHECK/ENUMs for role/status/scope/owner_type; `ondelete` per FK; `PRAGMA foreign_keys=ON` for dev parity; unique `(project_id, lower(doi))`; real FK for `owners.created_by_user_id`.
6. **[H2/H3/H4] Type & index modernization**: JSONB-with-variant, native `UUID` PKs, `memberships.user_id` + `document_comments.user_id` + `document_versions.user_id` + `papers.pmid` indexes, composite `(project_id, created_at)` and `(document_id, position)`.
7. **[M1/M4] Operational hardening**: explicit pool settings + `statement_timeout`; move migrations to deploy-time with advisory locking.
8. **[I1] CI on PostgreSQL** with the full suite plus an Alembic autogenerate-drift check — the cheapest structural prevention for every finding above recurring.
9. **[M2/M3/M7] Query-path cleanup** — batch the lit-matrix chunk loads, deepen reply eager-loading, pre-filter popover candidates in SQL, and demote `ensure_default_plugins` to a startup/migration task.
10. **[L4] CITEXT (or normalized-lower unique index) for emails** once user-facing multi-account usage grows.

---

*End of report — generated by read-only audit, skill: postgresql-code-review.*
