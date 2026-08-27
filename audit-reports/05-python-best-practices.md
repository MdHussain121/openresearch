# Python Best Practices Audit — OpenResearch `apps/api`

**Audit date:** 2026-08-26
**Auditor:** ox-alpha (read-only audit, `python-best-practices` skill applied)
**Target:** `apps/api` (FastAPI backend) — 75 application source files, plus packaging/config (`pyproject.toml`, `requirements.txt`, `requirements.lock`, `alembic.ini`, `.env.example`, `.pre-commit-config.yaml`, root `.python-version`)
**No files were modified.**

---

## Scope & Methodology

### In scope
| Area | Files reviewed |
|---|---|
| Packaging & config | `apps/api/pyproject.toml`, `requirements.txt`, `requirements.lock`, `apps/api/alembic.ini`, `apps/api/.env.example`, `apps/api/.env` (local, untracked), root `.python-version`, `.pre-commit-config.yaml`, `infrastructure/Dockerfile.api`, `docker-compose*.yml` (env wiring only), `start_openresearch.cmd` / `run.cmd` (launch path) |
| Core | `app/core/{config,database,http_client,middleware,rate_limit,text_utils,constants}.py` |
| Services (all of them) | `auth.py`, `llm_service.py`, `provider_settings.py`, `provider_cache_service.py`, `rag_service.py`, `literature_search_service.py`, `identifier_resolver.py`, `intelligence_service.py`, `graph_service.py`, `export_service.py` + full `services/export/*` subpackage (`ast_parser`, `csl_formatter`, `markdown_exporter`, `bibtex_exporter`, `docx_exporter`, `pdf_exporter`, `service`, `options`), `pdf_extractor.py`, `plugin_runtime.py`, `plugin_service.py`, `tabby_setup_service.py`, `zotero_service.py`, `ai_writing_service.py` |
| Plugins | `app/plugins/{arxiv_provider,crossref_provider,csl_processor,ghost_writer,latex_exporter}.py` |
| API layer | `app/main.py`, `app/api/v1/api.py`, endpoint modules: `auth`, `ai_writing`, `chat`, `citations`, `collaboration`, `comments`, `documents`, `export`, `graphs`, `health`, `intelligence`, `papers`, `plugins`, `projects`, `provider_settings`, `provider_status`, `research`, `teams`, `version_history`, `zotero` |
| Models & schemas | All 12 models under `app/models/`, `app/schemas/models.py` (1,027 lines), both `__init__.py` re-export layers |
| Migrations & tests | `alembic/env.py`, migration files (structure only), `tests/conftest.py`, test inventory (40 files) |

### Methodology
1. Loaded the **python-best-practices** skill (type-first design, frozen dataclasses / discriminated unions / `Literal`, `NewType`, `Protocol`, exception chaining with `from`, structured lazy `%s` logging).
2. Full read of every module listed above; cross-referenced call paths between endpoints and services to classify sync/async blocking behavior.
3. Verified configuration behavior empirically: confirmed the launcher runs `python -m uvicorn app.main:app --reload --port 8000` with **no** `--env-file`, and that `SettingsConfigDict` has no `env_file`.
4. Ran the project's own tooling read-only for objective evidence: `ruff check app tests` → **All checks passed**; `mypy app` → **Success: no issues found in 75 source files**.
5. Repo-wide greps: f-string logging sites, `except Exception:` sites (24 locations), mutable-default patterns, `raise ... from` usage, `_check_*_access` duplication counts, dead dependency usage (`pgvector`, `psycopg2`).
6. Checked git tracking status: `.env`, `api.log`, `*.db` are **not** tracked (good).

### Excluded per instructions
`node_modules`, `.venv`, `.next`, `__pycache__`, coverage artifacts, `storage/`, logs, frontend (`apps/web`), `packages/*`.

---

## Executive Summary

| Severity | Count |
|---|---:|
| **CRITICAL** | 0 |
| **HIGH** | 3 |
| **MEDIUM** | 9 |
| **LOW** | 12 |
| **INFO** | 4 |
| **Total** | **28** |

**Headline findings**

1. **HIGH — The settings stack is configured but not actually used.** Every field in `Settings(BaseSettings)` is eagerly resolved with manual `os.getenv(...)` at class-definition time and `SettingsConfigDict` never declares `env_file`. Combined with a launcher that doesn't pass `--env-file`, the `apps/api/.env` file is **silently ignored**; malformed integer env values crash the process at import with an opaque `ValueError` instead of a Pydantic validation error.
2. **HIGH — Blocking synchronous I/O on the asyncio event loop** in genuinely `async def` code paths: sync Redis calls (with 1 s socket timeouts) inside the async literature-search/identifier-resolution hot path, and a sync SQLAlchemy query inside an async graph-discovery handler.
3. **HIGH — Dependency drift between `pyproject.toml` and `requirements.txt`**: three packages declare different minimum versions in each file, so pip-tools compiles the lock from constraints that don't match the declared project metadata.

The codebase is otherwise in notably good shape for its stage: ruff and mypy pass clean, SQLAlchemy 2.0 typed mappings throughout, honest-failure semantics are documented and consistently implemented, uploads stream to disk with hard size caps, and production misconfiguration is actively refused at startup.

---

## Detailed Findings

Severity legend:
- **CRITICAL** — will cause outage/data loss/security breach as written.
- **HIGH** — incorrect or silently degraded behavior likely in normal operation.
- **MEDIUM** — maintainability/correctness risk that will bite during change or scale.
- **LOW** — style/hygiene deviation with limited runtime impact.
- **INFO** — observation worth recording.

---

### HIGH

#### H1. pydantic-settings is bypassed; `.env` file is silently never loaded
**File:** `apps/api/app/core/config.py:16-115`; launch path `start_openresearch.cmd` (`:START_BACKEND` subroutine); `infrastructure/Dockerfile.api:36`

```python
class Settings(BaseSettings):
    ...
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./openresearch_dev.db")
    SECRET_KEY: str = os.getenv("SECRET_KEY", DEFAULT_DEV_SECRET_KEY)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", str(60 * 24)))
    TABBY_AUTOCOMPLETE_ENABLED: bool = os.getenv("TABBY_AUTOCOMPLETE_ENABLED", "false").strip().lower() in ("1","true","yes","on")
    ...
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")   # ← no env_file
```

Problems, concretely:

1. **`.env` is dead config.** `SettingsConfigDict` lacks `env_file=".env"`; nothing in the app calls `load_dotenv()` (verified by grep); and the Windows launcher starts uvicorn without `--env-file`. A developer who edits `apps/api/.env` (e.g., changes `SECRET_KEY`, `UPLOAD_DIR`, `CORS_ORIGINS`) gets **zero effect** with no warning. Docker Compose happens to work because it injects real environment variables — masking the bug in one deployment mode only.
2. **Import-time crash on bad input.** Because coercion happens in the class body (`int(os.getenv(...))`), a typo like `LLM_TIMEOUT_SECONDS=twenty` kills the process at import with `ValueError: invalid literal for int()`, not a Pydantic `ValidationError` listing the offending field. Same class of problem for the hand-rolled bool parser on `config.py:80-85`.
3. **Redundant double-parsing.** pydantic-settings already resolves env vars by field name; wrapping every default in `os.getenv` means each value is effectively parsed twice through two different mechanisms, and `case_sensitive=True` interacts confusingly with hand-written lookups.
4. **Test smell confirms confusion:** `tests/test_cov_services_final.py:41` constructs `Settings(_env_file=None, ...)`, implying the author believed an env file was wired up.

**Fix**

```python
class Settings(BaseSettings):
    ENVIRONMENT: Literal["development", "production", "test"] = "development"
    DATABASE_URL: str = "sqlite:///./openresearch_dev.db"
    SECRET_KEY: str = DEFAULT_DEV_SECRET_KEY
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    TABBY_AUTOCOMPLETE_ENABLED: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False, extra="ignore")
```
…and add `--env-file .env` (or rely on the now-working `env_file`) in the launcher. Keep the excellent `validate_production_security` model validator unchanged.

---

#### H2. Blocking sync I/O executed directly on the event loop in `async` code paths

The service layer is deliberately synchronous (fine — most endpoints are `def`, which FastAPI runs on a threadpool). The defect is the handful of places where sync I/O is invoked from *actual* `async def` coroutines without `anyio.to_thread.run_sync` (a pattern the codebase itself uses correctly elsewhere, e.g. `papers.py:86,190`, `citations.py:269,307`, `ai_writing_service.py:172`).

**(a) Sync Redis inside async literature search / identifier resolution**
**Files:** `app/api/v1/endpoints/research.py:17,51`; `app/services/literature_search_service.py:111-121,183,275,385,483`; `app/services/provider_cache_service.py:52-66,83-95,116-121`; same cache calls from async `identifier_resolver.resolve_doi/arxiv/pmid` (`identifier_resolver.py:75,137,174,232,247,297`).

```python
@router.get("/research/search", ...)
async def search_online_literature(...):
    return await literature_search_service.search(...)   # internally calls provider_cache_service.get()/set()
```

`provider_cache_service.get/set` performs **synchronous redis-py** network round-trips with `socket_timeout=1.0, socket_connect_timeout=1.0` (`provider_cache_service.py:57-58`). On every miss/set with Redis reachable this stalls the entire event loop up to ~1–2 s, freezing **all** concurrent requests, WebSockets included. Even the first-call `client.ping()` probe blocks.

**Fix:** make the cache async (`redis.asyncio`, already used in `collaboration.py:81`) or wrap cache access in `await anyio.to_thread.run_sync(...)` at the two async call sites; better, give `ProviderCacheService` an async twin since all its callers in async contexts are the lit-search/resolver paths.

**(b) Sync DB query inside async handler**
**File:** `app/services/graph_service.py:187-194` called from `app/api/v1/endpoints/graphs.py:40`

```python
@staticmethod
async def discover_related_work(db: Session, project_id: str) -> List[DiscoveryRecommendation]:
    papers: List[Paper] = db.query(Paper).filter(Paper.project_id == project_id).all()   # sync ORM I/O on loop
```

**Fix:** either make the endpoint `def` (it does almost no concurrency-relevant waiting besides one httpx call) or offload: `papers = await anyio.to_thread.run_sync(lambda: db.query(Paper)...all())` — mirroring `add_paper_by_identifier` which already does exactly this correctly (`citations.py:269`).

**(c) WebSocket holds the request-scoped DB session for the socket's lifetime**
**File:** `app/api/v1/endpoints/collaboration.py:227-244`

```python
async def websocket_collaboration(websocket: WebSocket, document_id: str, db: Session = Depends(get_db)):
```

`get_db` yields one session that stays checked out from the pool until the WS disconnects — one pooled connection pinned **indefinitely per connected collaborator** (the code even opens its own short-lived `SessionLocal()` for persistence at line 42, proving the long-lived one isn't needed after auth). Under SQLite/WAL this also extends write-lock windows.

**Fix:** perform auth + document lookup in a scoped session, then close it; keep using `_persist_doc_edit`'s own session pattern for writes. E.g. accept `websocket` only, and do `with SessionLocal() as db: user = await _authenticate_websocket(...)` before entering the message loop.

---

#### H3. Dependency drift: `requirements.txt` vs `pyproject.toml` disagree; lock built from the wrong one
**Files:** `apps/api/pyproject.toml:7-42` vs `apps/api/requirements.txt:16-18`; `requirements.lock:1-5`

| Package | `pyproject.toml` `[project.dependencies]` | `requirements.txt` |
|---|---|---|
| `python-docx` | `>=1.1.0` | `>=1.2.0` |
| `reportlab` | `>=4.2.0` | `>=4.5.0` |
| `pypdf` | `>=4.2.0` | `>=5.0.0` |

Additional hygiene issues in the trio:

- Two competing sources of truth. The lock header says it was compiled from `requirements.txt`, so the *declared* metadata in `pyproject.toml` (what any `pip install openresearch-api` consumer would use) permits older floors than what CI/dev actually installs. Anyone installing via `[project]` metadata can resolve to a combination never exercised by the team.
- `requirements.lock` includes dev/test tooling (`pytest==9.1.1`, `mypy==2.3.1`, `ruff==0.16.4`, `coverage`, etc.) because `requirements.txt` merges runtime and dev deps. There is no production-only lock artifact.
- Runtime deps and dev extras are duplicated in three places (`[project.dependencies]`, `[project.optional-dependencies].dev`, `requirements.txt`) — the classic triple-bookkeeping that guarantees future drift (it already happened).
- `httpx>=0.27.0` appears both in runtime deps *and* in the `dev` extra (`pyproject.toml:19,36`) — redundant.
- The `all` extra (`pyproject.toml:39-42`) duplicates the `postgres` extra verbatim; presumably intended to be `postgres + dev`.
- Lock entries lack hashes (`pip-compile --generate-hashes` unused), so supply-chain verification is unavailable while a fully pinned lock *does* exist.

**Fix:** pick one workflow. Recommended minimal: delete `requirements.txt`'s duplicated pins, generate `requirements.lock` from `pyproject.toml` (`pip-compile pyproject.toml --extra postgres -o requirements.lock`), and produce a separate `requirements-dev.lock` (or adopt `uv`'s `uv.lock`). Reconcile the three version floors listed above.

---

### MEDIUM

#### M1. Provider-cache telemetry is wrong by construction: hardcoded provider attribution
**Files:** `app/services/literature_search_service.py:110-121` vs `app/services/provider_cache_service.py:40-50,68,102`

```python
# literature_search_service.py — shared by ALL four providers
@staticmethod
def _cache_get(cache_key: str) -> Any:
    return provider_cache_service.get(cache_key, provider_name="OpenAlex")

@staticmethod
def _cache_set(cache_key, data):
    provider_cache_service.set(cache_key, ..., provider_name="OpenAlex")
```

while `_provider_stats` only tracks keys `("Crossref", "arXiv", "PubMed")` (`provider_cache_service.py:49-50`). Net effects:

1. Crossref/arXiv/Semantic Scholar searches are all counted as **OpenAlex** hits/misses;
2. OpenAlex itself is absent from `_provider_stats`, so `/system/provider-status` reports zero activity for it while showing stale zeros for providers whose counters can only ever move via `identifier_resolver`;
3. The quota dashboard's stated purpose ("protect free-tier usage limits… OpenAlex 100k requests/month", class docstring lines 25-28) is defeated — the one rate-limited provider nobody measures is the busiest one.

**Fix:** thread the real provider key through `_dispatch` into `_cache_get/_cache_set`, and initialize stats from `PROVIDER_NAMES` (single source of truth) instead of a hardcoded tuple that omits OpenAlex and invents PubMed-without-a-litsearch-path.

#### M2. `ProviderCacheService` global state is not thread-safe
**File:** `app/services/provider_cache_service.py:32-121`

`self._cache: OrderedDict` and `_provider_stats` are mutated from FastAPI's threadpool (every sync endpoint calling lit-search or resolver paths concurrently) with **no lock**, while sibling module `provider_settings.py:76` demonstrates the correct idiom (`_lock = threading.Lock()` around store access). Races include: LRU eviction vs concurrent `move_to_end` (`popitem` during reorder can raise or corrupt order), lost counter increments, and a thundering-herd on `_redis_checked` where several threads can construct Redis clients simultaneously. Contrast with `llm_service._check_rate_limit` (`llm_service.py:54`) which correctly locks its deque.

**Fix:** add `self._lock = threading.Lock()` guarding `get/set/clear` and the stats mutations; make `_redis_checked` assignment happen inside the lock (or use `functools.cached_property`-style double-checked init).

#### M3. Import-time side effects and pervasive module-level mutable singletons
**Files:** `app/core/database.py:7-22` (engine created at import), `app/core/config.py:115` (`settings = Settings()` — reads env at import), `app/api/v1/endpoints/collaboration.py:168` (`collab_manager = CollaborationRoomManager()` — constructs an **asyncio Redis client at import time**, before any event loop exists), `app/services/llm_service.py:593`, `rag_service.py:900`, `provider_cache_service.py:190`, `literature_search_service.py:532`, `identifier_resolver.py:310`, `zotero_service.py:229`, `ai_writing_service.py:447`, `intelligence_service.py:681`, `plugin_runtime.py:24` (`_RESOLUTION_CACHE`), `app/api/v1/endpoints/auth.py:30-38` (three rate limiters).

Consequences observed in the code itself:

- Tests must monkeypatch the singleton (`conftest.py:39,50`: `monkeypatch.setattr(settings, "REDIS_URL", "")`, `monkeypatch.setattr(settings, "UPLOAD_DIR", ...)`) rather than injecting config — the singletons capture `settings` values indirectly at call time, which works today but breaks the moment anyone caches a setting in `__init__` (e.g. `PDFExtractorService.__init__` snapshots `settings.GROBID_URL` at import via the module-level `pdf_extractor = PDFExtractorService()`, `pdf_extractor.py:742` — changing `GROBID_URL` in tests has no effect).
- `CollaborationRoomManager.__init__` calls `redis.asyncio.from_url(...)` at module import (`collaboration.py:79-85`); if REDIS_URL points at a lazily-started container this is merely wasted, but it makes import order and env availability matter for correctness.
- Rate limiter windows live for process lifetime keyed by IP with no eviction of idle keys (`rate_limit.py:29` — `defaultdict(deque)` grows unboundedly with unique visitor IPs; only `reset()` clears everything).

**Fix direction:** keep module-level convenience instances if desired, but (a) construct expensive resources lazily (first use / lifespan), (b) have services take `settings` (or sub-configs) as constructor arguments so tests instantiate isolated copies, (c) add periodic eviction of stale IP buckets (drop buckets whose last hit exceeds the window during `check` sweeps).

#### M4. Database access anti-patterns: N+1 loops, O(N²) scans, and an unused vector index
**(a) Zotero import dedup N+1** — `app/services/zotero_service.py:117-126`: for each item, up to two `db.query(Paper).filter(...).first()` probes (DOI then title). Importing 500 items ⇒ ~1,000 sequential queries inside one transaction.
**Fix:** pre-fetch the project's `(doi→id)` and `(title→id)` maps once (`defaultdict`) and probe in memory; fall back to queries only on conflict-commit.

**(b) Per-paper chunk fetch loops** — `app/services/intelligence_service.py:227` (`.limit(10).all()` per paper inside `for paper in papers:`) and again `intelligence_service.py:414-419` (full chunk list per paper). With P papers ⇒ P queries loading potentially large text blobs.
**Fix:** one query `WHERE paper_id IN (...)` grouped in Python, or `selectinload(Paper.chunks)`.

**(c) Quadratic citation-link matching** — `app/services/graph_service.py:123-139`: `for p1 in papers: for ref in refs: for p2 in papers:` ⇒ O(P·R·P). Acceptable at toy scale, quadratic at realistic library scale.
**Fix:** build `doi_index`/normalized-title dict of papers once, then O(P·R) lookups.

**(d) Hybrid search scans every chunk and computes cosine in pure Python** — `app/services/rag_service.py:354-433`. Mitigations present (`yield_per(500)`, bounded top-N heap, batched hydration — genuinely good), but complexity remains O(chunks × dim) per keystroke-driven autocomplete query (`ai_writing_service.py:101` calls it on every autocomplete request).
**Fix:** `pgvector` is already a declared dependency (`pyproject.toml:29`, `requirements.txt:9`, locked at `requirements.lock:87`) yet **never imported anywhere** (grep-verified). When Postgres is configured, store embeddings as `vector(128)` and let pgvector do ANN; keep the JSON+Python path strictly for SQLite. This converts the hot loop into an indexed top-K query.

#### M5. Stringly-typed domain states defeat the type system
**Files (non-exhaustive):** `app/schemas/models.py:234,290-293,303,309,318,450,464,488,562,586,615,645,675,737,745,777-798,902,911,951`; `app/models/paper.py:35`, `app/models/plugin.py` (`plugin_type` comment enumerates five legal values), `app/models/citation.py` (`attribution_scope`), `app/models/membership.py` (`role`), `app/core/config.py:27` (`ALGORITHM`), `app/core/text_utils.py` (style dispatch across ~26 string literals repeated in three functions).

Examples:

```python
grounding_state: str  # 'source-grounded' | 'ai-inference' | 'general-knowledge'
mode: str             # 'document' | 'library' | 'project' | 'general'
role: str             # 'owner' | 'editor' | 'viewer'
plugin_type: str      # 'research_provider' | 'ai_provider' | ...
extraction_status: str  # 'ok' | 'unverified' | 'unresolved'
engine: str           # 'auto' | 'tabby' | 'cloud' | 'ollama'
```

Every one of these is validated (if at all) by scattered runtime checks — e.g. role validation duplicated verbatim in two validators (`schemas/models.py:780-786` and `792-798`), mode whitelisting reimplemented in both `chat.py:23-25` and `rag_service.stream_chat_response:605-606`, engine membership tested against a tuple constant in `provider_settings.py:59`. Typos compile fine and fail at runtime (or silently fall through to defaults, as `_resolve_mode` does).

This is precisely the skill's "make illegal states unrepresentable" violation: these should be `Literal` / `enum.StrEnum` types shared by models, schemas, and services:

```python
class GroundingState(StrEnum):
    SOURCE_GROUNDED = "source-grounded"
    AI_INFERENCE = "ai-inference"
    GENERAL_KNOWLEDGE = "general-knowledge"

class MembershipRole(StrEnum):
    OWNER = "owner"; EDITOR = "editor"; VIEWER = "viewer"
```
Pydantic v2 serializes `StrEnum` members transparently; SQLAlchemy columns can keep `String` storage with a `Mapped[MembershipRole]` + `Enum(MemberShipRole, native_enum=False, length=...)` or validate at the schema boundary only. The citation-style strings alone (~26 literals dispatched identically in `text_utils.format_authors_inline`, `format_authors_bibliography`, `format_inline_marker`, and `csl_formatter.format_bibliography_entry`) would benefit enormously from a `CitationStyle` enum + per-style formatter registry instead of four parallel `elif` ladders (see M8-duplication).

#### M6. Author-name parsing implemented five times with mutually inconsistent heuristics
**Files:**
- `app/services/literature_search_service.py:22-26` — family = **last** token (`parts[-1]`);
- `app/services/identifier_resolver.py:196-199` (arXiv) — family = last token;
- `app/services/identifier_resolver.py:258-263` (PubMed) — family = **first** token (`parts[0]`), given = rest — opposite convention from the other four;
- `app/core/text_utils.py:34-53,56-78` — third extraction chain (`familyName`/`literal`/`name`) duplicated across `format_authors_summary` and `format_authors_inline`;
- `app/services/export/bibtex_exporter.py:17-27` — fourth variant;
- `app/models/paper.py:55-63` (`primary_author_name`) — fifth variant.

Also XML-as-regex parsing duplicated: `literature_search_service.search_arxiv:400-446` and `identifier_resolver.resolve_arxiv:181-211` independently implement `content.split("<entry>")` + `<title>`/`<author>`/`<summary>` regexes. Regex/XML parsing of arXiv Atom feeds breaks on titles containing `]]>`-edge entities, namespaces, or multi-`<entry>` payloads; stdlib `xml.etree.ElementTree` (already used correctly for GROBID TEI in `pdf_extractor._parse_tei_xml`) is the right tool and should be shared.

**Fix:** one `authors.py` helper module (`parse_person_name(name) -> Author`, `authors_to_bibtex(authors) -> str`, `parse_arxiv_feed(xml_text) -> list[Entry]`) consumed by both services; reconcile PubMed's first-name-family convention explicitly (NCBI formats `"Last, First"` in `authors[].name` — splitting on `,` first is the actual fix, the current `parts[0]` produces wrong family names for plain `"First Last"` strings).

#### M7. Structural duplication across exporters, endpoints, and the schema monolith
**(a) Citation-map construction triplicated** — byte-for-byte logic in `markdown_exporter.py:36-49`, `docx_exporter.py:73-83`, `pdf_exporter.py:220-230`:
```python
citation_map: Dict[str, Tuple[Paper, int]] = {}
ordered_papers: List[Paper] = []
for citation in citations: ...
if not ordered_papers and papers: ...
```
Extract `build_citation_map(citations, papers) -> tuple[dict, list]` into `ast_parser`/`options`.

**(b) PaperChunk construction triplicated** — `rag_service.py:115-130, 157-174, 184-201, 207-223` repeat the identical 15-line `PaperChunk(...)` literal (plus twice more in tables/equations helpers). Extract `_make_chunk(paper, author_str, page, section, para, content, extra_meta=None)`.

**(c) Endpoint access-guard boilerplate ×10 modules** — grep count: the `query → 404 → verify_user_access_to_owner → 403` block is hand-rolled separately in `documents.py`, `comments.py:_check_doc_access`, `version_history.py:_check_doc_access`, `teams.py`, `zotero.py:_check_project_access`, `graphs.py:_check_project_access`, `intelligence.py:_check_project_access`, `chat.py` (×3 inline), `ai_writing.py` (×4 inline), `papers.py` (inline + nested closures), `citations.py` (nested closure). Six near-identical private helpers coexist. A reusable FastAPI dependency (`Depends(project_access("owner","editor"))`) or a single `require_document_access(db, user, doc_id, roles)` in `services/auth.py` removes ~200 lines and the drift risk (some copies check roles, some don't — e.g. `chat.py:49` omits `required_roles` entirely while `papers.upload:79` demands editor; whether that asymmetry is intentional is undocumented).

**(d) `schemas/models.py` monolith** — 1,027 lines, ~90 Pydantic classes spanning auth, RAG, citations, AI-writing, export, intelligence, Zotero, teams, collaboration, versions, graphs, plugins, literature. The package re-export layer `schemas/__init__.py` exports only the original Phase-1 subset (25 names), so half the codebase imports from `app.schemas.models` directly and half could import from `app.schemas` — two canonical paths. Split into `schemas/{auth,projects,documents,papers,citations,rag,writing,export,intelligence,zotero,teams,collab,graphs,plugins,literature}.py` with `__init__` aggregating everything.

**(e) Misc duplicates** — role validator copy-paste (`models.py:780-786` vs `792-798`); "Not stated" cell construction duplicated inside `generate_literature_matrix` (`intelligence_service.py:421-439` vs `450-467`); DOI-cleaning exists in three variants (`literature_search_service._clean_doi:29-34`, `identifier_resolver.clean_doi:35-39`, `crossref_provider._DOI_PREFIXES` strip).

#### M8. Exception-handling gaps
**(a) Lost exception chaining on refresh** — `app/api/v1/endpoints/auth.py:99-102`:
```python
try:
    payload = decode_token(token_in.refresh_token, expected_type="refresh")
except Exception:
    raise credentials_exception        # ← original error discarded
```
Violates the skill's chaining rule; debugging "why was my refresh rejected" (expired? wrong type? bad signature?) is impossible from logs. Fix: `except jwt.InvalidTokenError as exc: raise credentials_exception from exc` (and narrow the catch — catching `Exception` here also masks DB errors raised by the subsequent query if reordered).

**(b) Broad swallow-and-return-None in `llm_service`** — `llm_service.py:78-79,118-122,147-148,208-212,228-230,364-365,419-422`. The "honest failure" contract (documented in the module docstring) is good product behavior, but `except Exception` without logging at the *point of catch* in `_probe_availability` (line 78: silent `self._available = False`, no log) hides root causes (proxy errors, DNS timeouts vs genuine downtime). Keep returning `None`, but log at DEBUG/WARNING with the exception, as lines 118-119 already do.

**(c) Silent broadcast failure** — `collaboration.py:141-154`: `except Exception: pass` around both Redis publish and per-socket sends; a systematically failing relay is invisible. At minimum `logger.debug("broadcast failed", exc_info=True)`.

**(d) Redundant exception tuple** — `collaboration.py:179`: `except (asyncio.TimeoutError, WebSocketDisconnect, json.JSONDecodeError, Exception):` — trailing `Exception` makes the other three dead entries.

**(e) `get_or_create_local_user` rollback path** — `services/auth.py:95-103` handles the IntegrityError race correctly but catches bare `Exception`; catching `sqlalchemy.exc.IntegrityError` specifically would avoid masking unrelated commit failures as "another request created the user".

#### M9. Non-deterministic `hash()` used for IDs — contradicts the codebase's own rule
**File:** `app/services/graph_service.py:256`
```python
id=f"rec-{doi}" if doi else f"rec-{abs(hash(title)) & 0xFFFFFFFF}",
```
`rag_service.EmbeddingService` documents and correctly avoids this exact pitfall (`rag_service.py:36-38`: *"builtin hash() is salted per process and must not be used"*). Recommendation IDs for papers without DOIs change on every restart/process, breaking any client-side caching or dedup keyed on `DiscoveryRecommendation.id`.
**Fix:** reuse `EmbeddingService._stable_hash` (blake2b) or `uuid.uuid5(NAMESPACE_URL, title)`.

---

### LOW

#### L1. Eager f-string logging defeats deferred interpolation (6 sites)
Skill prescribes `logger.info("...%s...", arg)` lazy formatting. Violations found by grep `logger.*\(f`:
- `app/core/middleware.py:57` — `logger.exception(f"[{request_id}] Unhandled server exception: {exc}")`
- `app/services/pdf_extractor.py:131` — `logger.info(f"GROBID service unavailable or failed ({e})...")`
- `app/services/pdf_extractor.py:158` — `logger.warning(f"GROBID returned status {resp.status_code}: {resp.text[:200]}")`
- `app/services/pdf_extractor.py:339` — `logger.debug(f"Table extraction error on page {page_num}: {ex}")`
- `app/services/rag_service.py:329` — `logger.info(f"Indexed paper {paper.id} ({paper.title}): {len(created_chunks)} chunks...")`
- `app/services/zotero_service.py:49` — `logger.error(f"Failed to parse Zotero JSON content: {e}")`

All other ~90 logging call sites in the codebase correctly use `%s` — these six are the outliers. Note `rag_service.py:329` additionally evaluates `paper.title` eagerly even when INFO is filtered out.

#### L2. Linter/type-checker configuration too narrow to earn "clean" status
**File:** `apps/api/pyproject.toml:44-59`

- `select = ["E", "F", "W", "I"]` — the four baseline rule families. No `B` (bugbear — would flag the redundant except tuple), `ASYNC` (would flag blocking calls in async — H2), `SIM`, `C4`, `PERF` (would flag some M4 loops), `RUF`, `ANN`. `B008` is ignored globally when it only needs a per-file ignore for FastAPI `Depends(...)` argument defaults.
- `ignore_missing_imports = true` disables the main value of mypy on third-party boundaries; no `disallow_untyped_defs`, no `strict_optional` tuning, no `warn_return_any`. The suite passes, but largely because it is configured to be unable to fail.
- Suggested increment (low churn given current cleanliness): `select = ["E","F","W","I","B","UP","SIM","PERF","RUF"]`, `ignore = ["B008"]` moved to per-file-ignores for `app/api/**`; mypy: drop `ignore_missing_imports` in favor of targeted `[[tool.mypy.overrides]]` per module, add `warn_unused_ignores`, `no_implicit_optional`.

#### L3. Implicit namespace packages for `app`, `core`, `services`, `api`, `endpoints`
Only `app/models/__init__.py`, `app/schemas/__init__.py`, `app/plugins/__init__.py`, `app/services/export/__init__.py` exist; `app/`, `app/core/`, `app/services/`, `app/api*/` have none. Works (and mypy's `namespace_packages = true` accommodates it), but regular packages are more explicit, enable tooling that assumes `__init__.py` (some coverage/packaging configs), and prevent accidental shadowing of top-level module names. Add empty `__init__.py` files (or document the namespace-package decision in CONTRIBUTING).

#### L4. `os.path`/`open()` vs `pathlib` inconsistency
`app/api/v1/endpoints/papers.py:47-49,99,127` uses `os.path.join/os.makedirs/os.remove`; `pdf_extractor.PDFValidator` uses `os.path.getsize/basename` while `tabby_setup_service.py` and `provider_settings.py:110-133` correctly use `pathlib.Path`. Pick `Path` everywhere (`dir_path = Path(settings.UPLOAD_DIR) / project_id; dir_path.mkdir(parents=True, exist_ok=True)`).

#### L5. BibTeX exporter output-quality issues
**File:** `app/services/export/bibtex_exporter.py:13-65`
- No escaping of BibTeX-special characters (`& % # _ ~`) in title/author/journal fields — a title like *"R&D Trends_2024"* produces a malformed entry.
- `year = paper.year or 2023` (line 34) fabricates a publication year; should omit the field or use `n.d.`-style handling consistent with the CSL formatters.
- Entry type is hardcoded `"article"` regardless of `metadata_json` hints (`booktitle` presence implies `inproceedings`).

#### L6. arXiv endpoints called over plain HTTP
**Files:** `literature_search_service.py:391` (`http://export.arxiv.org/api/query`), `identifier_resolver.py:179`. arXiv supports HTTPS on export.arxiv.org; plaintext risks content tampering in transit and mixed-mode proxy issues. (Zotero/Crossref/OpenAlex/S2 calls all correctly use https.)

#### L7. Endpoint reaches into a service's private method
**File:** `app/api/v1/endpoints/papers.py:549`
```python
llm_answer = rag_service._llm_grounded_answer(user_prompt or query, "document", passages)
```
Promote `_llm_grounded_answer` (and arguably `_grounded_messages`) to public API on `RAGService` — the endpoint is a legitimate consumer of exactly this contract.

#### L8. Unused request parameters
`register/login/refresh_tokens` in `app/api/v1/endpoints/auth.py:54-92` accept `request: Request` solely to mirror the rate-limit dependency signature (which binds its own request); the parameter is never referenced. Drop it or prefix `_`.

#### L9. Hand-rolled classes where dataclasses fit the skill guidance
- `ast_parser.ParsedBlock` (`ast_parser.py:13-27`) — plain mutable class mixing concerns (`table_rows` bolted on post-init); a `@dataclass(slots=True)` (or frozen + builder for children) gives `__eq__`/`__repr__` for tests and documents the shape.
- Positive contrast: `options.ExportOptions` already uses `@dataclass` — extend the pattern.
- `intelligence_service._MATRIX_DIMENSIONS: dict` (`intelligence_service.py:362`) — untyped class attribute; annotate `ClassVar[Dict[str, Tuple[str, ...]]]` and freeze contents.

#### L10. Coverage gate coupled into `pytest` addopts drives low-value tests
**File:** `pyproject.toml:64-65` — `addopts = "--cov=app --cov-report=term-missing:skip-covered --cov-fail-under=94"`.
Coverage on every pytest invocation slows iteration and, at a hard 94%, demonstrably incentivized coverage-targeted test files (`tests/test_cov_services_final.py`, `test_cov_services_final`, `test_cov_papers_citations.py`, `test_cov_endpoints_core.py`, `test_cov_final_sweep.py`, `test_text_utils_coverage.py` — 6 of 40 files exist primarily to satisfy the gate). Move coverage to a dedicated CI step (`pytest --cov ... --cov-fail-under=94` there), keeping local runs fast; prefer mutation or assertion-quality checks over a raw percentage.

#### L11. `.env.example` incomplete relative to `Settings`
`apps/api/.env.example` documents 20 vars but omits 8 configurable fields that exist in `config.py`: `PLUGIN_ALLOWED_MODULE_PREFIXES`, `LLM_TIMEOUT_SECONDS`, `LLM_MAX_CONTEXT_CHARS`, `LLM_MAX_TOKENS`, `LOGIN_RATE_LIMIT_MAX_REQUESTS`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS`, `REGISTER_RATE_LIMIT_MAX_REQUESTS`, `REGISTER_RATE_LIMIT_WINDOW_SECONDS`. Once H1 is fixed (env actually loaded) this gap becomes user-visible. Also duplicate legacy aliases (`GROBID_HOST`, `OLLAMA_HOST`) are documented while the plugin-prefix var isn't.

#### L12. Assorted small idioms
- **Out-parameter dict** — `zotero_service.import_csl_or_api_data(..., version_out: Optional[Dict]=None)` mutates a caller-supplied dict to return a second value (`zotero_service.py:39,60-61`, consumed at `sync_library:213-225`). Return `tuple[ZoteroImportResponse, Optional[int]]`.
- **MD5 for claim IDs** — `intelligence_service.py:140` uses `hashlib.md5(sent.encode())[:12]` while `rag_service` standardizes on blake2b (`rag_service.py:43`). Not security-relevant here, but pick one internal hash convention (blake2b, digest_size=8).
- **camelCase local** — `persName` in `pdf_extractor._parse_tei_xml:184` (only snake_case elsewhere).
- **Magic numbers** — `rag_service` thresholds (`0.68`, `0.55/0.45`, `0.85`, `600`, `1000`, `30`) and `intelligence_service` score floors (`max(50, 100 - n*20)`) are inline; hoist to named module constants alongside `EMBEDDING_DIM`.
- **`stream_autocomplete` fake streaming** — `ai_writing_service.py:161-182` yields one big frame then done over SSE labeled as streaming; docstring is honest about it, but consider wiring `llm_service.stream_generate` (which exists and is used by chat) for true deltas.

---

### INFO

#### I1. Declared-but-unused dependencies
`pgvector` (see M4-d) and `psycopg2-binary` are declared/locked but `psycopg2` is likewise never imported (SQLAlchemy dialect loads it implicitly only when a Postgres URL is used — acceptable, but worth noting the extras exist purely as driver provisioning). If Postgres support is aspirational, mark them as such; if real, the missing pgvector integration is the gap.

#### I2. Toolchain version skew between pre-commit and the venv
`.pre-commit-config.yaml:17-19` pins `ruff-pre-commit rev: v0.4.4` while the venv/lock run `ruff 0.16.4` (`requirements.lock:141`). Rules and formatting differ meaningfully across that span — commits can pass hooks yet fail CI lint (or vice versa). Align the hook rev with the locked ruff (or use `rev: v0.16.4` / local hook invoking `.venv`).

#### I3. Python version targeting is coherent
`requires-python = ">=3.11"` (`pyproject.toml:6`), `[tool.ruff] target-version = "py311"`, `[tool.mypy] python_version = "3.11"`, root `.python-version` = `3.11`, lock compiled under 3.11 — all five agree. One nit: `.python-version` sits at repo root rather than `apps/api/` (pyenv/rye lookup still resolves it for subdirs, so this works; colocating it would be tidier in a monorepo with non-Python apps). Code appropriately uses 3.10+ syntax (`X | None` unions in plugins) without needing it in hot paths.

#### I4. Lockfile provenance
`requirements.lock` is pip-compile output with transitive provenance comments (good practice) but without hashes (see H3) and includes a `--strip-extras` note; regenerate cadence isn't documented anywhere (CONTRIBUTING covers contribution rules but not dependency-refresh policy).

---

## Project Configuration Review

### `pyproject.toml` completeness matrix

| Section | Present | Assessment |
|---|---|---|
| `[project] name/version/description/readme` | ✅ | `readme = "README.md"` — but **no README.md exists in `apps/api/`** (root README only). Any build of the wheel/sdist metadata will fail or warn. Either ship an api README or point at `../README.md`-style relative (not allowed by spec — use a docs URL instead). |
| `[project] license, authors, classifiers, keywords, urls` | ❌ | Missing entirely; matters if the package is ever published/internal-indexed. Monorepo app exemption is defensible, but then say so. |
| `[project] requires-python` | ✅ | `>=3.11`, consistent everywhere (I3). |
| `[project] dependencies` | ✅ | Reasonable floors; drifts from requirements.txt (H3). |
| `[project.optional-dependencies]` | ⚠️ | `postgres`, `dev`, `all` — `all` is a mis-implemented alias (duplicates `postgres` only, despite the name suggesting `postgres+dev`). |
| `[build-system]` | ❌ | No build backend declared. `pip install -e ./apps/api` (needed for editable plugin-prefix resolution outside the cwd) relies on setuptools fallback heuristics. Add `[build-system] requires=["setuptools>=68"] build-backend="setuptools.build_meta"` + `[tool.setuptools.packages.find] include=["app*"]`. |
| `[project.scripts]` | ❌ | No console entrypoint; launching depends on the Windows `.cmd` scripts — not portable to Linux self-hosters despite the docker images suggesting cross-platform intent. |
| `[tool.ruff]` | ⚠️ | Correct target/excludes; rule selection minimal (L2). `exclude` covers `.venv`/`alembic`; add `storage`, `*.egg-info` defensively. |
| `[tool.ruff.lint.per-file-ignores]` | ❌ | Global `ignore=["E501","E741","B008"]` — E501 disabled wholesale instead of formatting-driven; B008 global instead of API-layer scoped. |
| `[tool.mypy]` | ⚠️ | Sensible base (`check_untyped_defs`, `explicit_package_bases`, namespace pkgs, alembic excluded) but lenient (L2). |
| `[tool.coverage.run]` | ⚠️ | `source=["app"]` only; no `branch = true`, no parallel/omit config; threshold lives in pytest addopts (L10). |
| `[tool.pytest.ini_options]` | ⚠️ | Coverage forced into every run via `addopts` (L10); `asyncio_mode` unset (pytest-asyncio 1.x defaults to strict mode — currently fine since tests use `TestClient`/manual loops via `conftest.fresh_event_loop_per_test`, but the custom autouse event-loop fixture fights pytest-asyncio's own management and will break if anyone adds `@pytest.mark.asyncio` tests without also configuring the plugin). `testpaths` unset — running `pytest` from `apps/api` also discovers nothing extraneous today, but pin `testpaths=["tests"]`. |
| `[tool.ty]` / other modern tools | ➖ | Skill suggests optional `ty`; not required. |

### Environment & secrets handling
- `.env` files present locally (`apps/api/.env`, root `.env`) and **not git-tracked** (verified via `git ls-files`) ✅.
- `.env.example` exists and documents safe defaults ✅, but incomplete (L11).
- Production guardrails in `Settings.validate_production_security` (`config.py:90-110`) are exemplary: refuses compromised/default/short secrets and SQLite in production. This materially offsets H1 — but note it validates values that, per H1, may not be the ones the operator thinks they set (an ignored `.env` means uvicorn defaults win silently).
- API keys stored plaintext in `storage/provider_keys.json` (`provider_settings.py:110-133`) with masked API responses — acceptable for a local-first desktop-style app and documented as such; flagged here only so the threat model remains explicit. File permissions are not tightened (`write_text` uses umask default); consider `chmod 600` equivalent on POSIX.
- `DEFAULT_HEADERS["User-Agent"]`/mailto contact reused inconsistently: `http_client.py:14` sets a shared UA, but `identifier_resolver.resolve_doi:79` overrides per-request with the identical value, and `zotero_service` sets a *different* UA (`OpenResearch/1.0` without mailto) — harmless but consolidate.

### Logging setup
- Module-scoped named loggers (`logging.getLogger("openresearch.<domain>")`) throughout ✅ — matches the skill's prescribed pattern.
- No centralized logging configuration (no dictConfig/fileConfig in app code; alembic's `fileConfig(alembic.ini)` applies only to migrations; `api.log` at `apps/api/` root suggests someone ran with a redirect). uvicorn defaults apply in dev. Consider a `configure_logging()` in `main.lifespan` (level from a new `LOG_LEVEL` setting, format including `request_id` from the middleware context) — currently correlation IDs are logged but nothing consumes/propagates them into record context (a `contextvars` filter would complete §3.5).
- Middleware logs every request at INFO with latency (`middleware.py:40-43`) — reasonable; f-string nit at line 57 (L1).

### Module organization & circular imports
- Layering is clean and acyclic: `api → services → core/models/schemas`; `models` use `TYPE_CHECKING` guards + string forward refs correctly (`paper.py:12-16`, `user.py:12-15`, `owner.py:12-15`); `main.py` defers heavy imports into functions where sensible (`main.py:44-48` lazy tabby import). No circular-import hacks found.
- Facade pattern `services/export_service.py` re-exporting `services/export/` preserves backward compatibility after modularization ✅ (though `__all__` ordering differs between the facade and package `__init__`, and the facade duplicates the entire export list — a third place to update when adding an exporter).
- `services/auth.py` doubles as the security module; naming (`services.auth` vs `api.endpoints.auth`) is slightly confusable but conventional.

---

## Positive Observations

The audit surfaced substantial strengths worth preserving as precedents:

1. **Production configuration guardrails** (`config.py:90-110`) actively reject known-compromised secret defaults, short secrets, and SQLite-in-production — rare and excellent.
2. **Honest-failure AI semantics** are documented and enforced end-to-end (`llm_service` docstring, `AIProviderUnavailableError`, "Insufficient evidence…" protocol, deterministic fallbacks) — the system declines to fabricate rather than hallucinating.
3. **Correct async-offloading where it counts**: upload streaming (`papers.py:101-132`), pdfplumber via `anyio.to_thread.run_sync` (`pdf_extractor.py:134`), DB save/chunk offload (`papers.py:163-190`), identifier-save flow (`citations.py:261-307`).
4. **Memory-bounded retrieval**: `hybrid_search` streams rows (`yield_per(500)`) into a bounded top-K heap (`rag_service.py:377-433`) with batched hydration of surviving papers only — textbook streaming top-K.
5. **Stable embeddings discipline**: BLAKE2b feature hashing with an explicit comment banning salted `hash()` (`rag_service.py:36-43`).
6. **SQLAlchemy 2.0 idiom**: `Mapped[]`/`mapped_column` typing everywhere, `TYPE_CHECKING` relationship cycles handled cleanly, WAL/busy-timeout pragmas for SQLite (`database.py:11-19`), `pool_pre_ping=True`.
7. **Secure-by-default details**: sanitized `X-Request-ID` charset to block log injection (`middleware.py:18,30`), fixed-argument subprocess lists with no shell interpolation (`tabby_setup_service.py:12`), first-frame WS auth keeping tokens out of URLs (`collaboration.py:171-175`), bounded WS frame size + sliding-window rate limit, PDF magic-byte validation mid-stream with partial-upload cleanup (`papers.py:110-130`), optimistic locking on documents (`documents.py:109-114`), IntegrityError retry for concurrent version allocation (`version_history.py:36-49`).
8. **Hermetic tests**: autouse fixtures isolate Redis, rate-limit state, and the provider-key store into `tmp_path` (`conftest.py:36-51`); StaticPool in-memory DB per function.
9. **Toolchain green**: `ruff check` and `mypy app` both pass with zero findings across 75 files.
10. **Thoughtful micro-copy in code**: docstrings explain *why* (winget PATH staleness in `tabby_setup_service.find_tabby_binary`, CREATE_NO_WINDOW/DETACHED_PROCESS MSDN constraint, arXiv-before-DOI ordering in `identifier_resolver.detect_identifier_type`).

---

## Prioritized Recommendations

### P0 — do next sprint (correctness in normal operation)
1. **H1**: Rewire `Settings` to declarative pydantic-settings fields with `env_file=".env"`; remove per-field `os.getenv`; add `--env-file` to the launcher for parity. Add a startup INFO log printing which config source won (never secret values).
2. **H3**: Reconcile `python-docx`/`reportlab`/`pypdf` floors between `pyproject.toml` and `requirements.txt`; generate the lock from `pyproject.toml`; split dev deps into their own lock.
3. **H2a/H2b**: Offload or async-ify the two event-loop blockers (`provider_cache` calls in async lit-search/resolver paths; `discover_related_work` DB query). Cheapest correct fix today: wrap in `anyio.to_thread.run_sync` at the async call sites.
4. **M1**: Fix provider attribution in `literature_search_service._cache_get/_cache_set` and align `_provider_stats` keys with `PROVIDER_NAMES`.

### P1 — next 1–2 months (structural debt that compounds)
5. **H2c**: Scope WS DB sessions to authentication, not socket lifetime.
6. **M2**: Add locking to `ProviderCacheService` (mirror `provider_settings._lock`).
7. **M5**: Introduce `StrEnum`s for `MembershipRole`, `GroundingState`, `ChatMode`, `PluginType`, `ExtractionStatus`, `AutocompleteEngine`; replace the two duplicated role validators with the enum.
8. **M6**: Extract shared author-name parsing + arXiv Atom parsing (ElementTree) into one module; fix PubMed family-name split.
9. **M7**: Extract `build_citation_map` and the PaperChunk factory; introduce a shared `require_project_access` dependency; plan the `schemas/` split.
10. **M4**: Pre-fetch dedup maps in Zotero import; batch chunk loading in intelligence; dict-based citation linking in graphs; adopt pgvector for Postgres deployments.

### P2 — hygiene passes (fit into ordinary PRs)
11. **M8/M9/L1**: Exception chaining (`from exc`) in `auth.refresh_tokens`; stop swallowing broadcast errors; replace `abs(hash(title))` with blake2b/uuid5; convert the six f-string log sites to `%s`.
12. **L2**: Widen ruff selection (`B`,`UP`,`SIM`,`PERF`,`RUF`) and scope `B008` per-file; tighten mypy incrementally.
13. **L3/L4/L9**: Add missing `__init__.py`s; standardize on `pathlib`; convert `ParsedBlock` to a dataclass.
14. **L5/L6/L7/L8/L12**: BibTeX escaping; HTTPS for arXiv; promote `_llm_grounded_answer` to public; drop unused `Request` params; replace `version_out` with a returned tuple; unify on blake2b for IDs.
15. **L10/L11/I2/I4**: Decouple coverage gate from local `pytest`; complete `.env.example`; bump pre-commit ruff rev to match the lock; add `[build-system]`, `license`, `authors` to `pyproject.toml`; create `apps/api/README.md` (currently referenced but missing).

---

*End of report — 28 findings (0 CRITICAL / 3 HIGH / 9 MEDIUM / 12 LOW / 4 INFO) over 75 source files, 100% of `app/services`, `app/core`, `app/plugins`, and all endpoint modules.*
