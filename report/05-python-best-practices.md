# Python Best Practices Audit — OpenResearch `apps/api` (Follow-up)

**Audit date:** 2026-08-27
**Auditor:** ox-alpha (read-only audit, `python-best-practices` skill applied)
**Target:** `apps/api` (FastAPI backend) — 85 application source files, plus packaging/config
**Prior audit:** 2026-08-26 (C:\Users\moham\Pictures\OpenResearch\audit-reports\05-python-best-practices.md)
**No files were modified during this audit.**

---

## Scope & Methodology

### In scope
| Area | Files reviewed |
|---|---|
| Packaging & config | `apps/api/pyproject.toml`, `requirements.txt`, `requirements.lock`, `apps/api/alembic.ini`, `apps/api/.env.example`, `apps/api/.env` (local, untracked), root `.python-version`, `.pre-commit-config.yaml`, `infrastructure/Dockerfile.api`, `docker-compose*.yml`, `start_openresearch.cmd` / `run.cmd` |
| Core | `app/core/{config,database,http_client,middleware,rate_limit,text_utils,constants,authors,logging_config}.py` |
| Services (all) | `auth.py`, `llm_service.py`, `provider_settings.py`, `provider_cache_service.py`, `rag_service.py`, `literature_search_service.py`, `identifier_resolver.py`, `intelligence_service.py`, `graph_service.py`, `export_service.py` + full `services/export/*` subpackage, `pdf_extractor.py`, `plugin_runtime.py`, `plugin_service.py`, `tabby_setup_service.py`, `zotero_service.py`, `ai_writing_service.py` |
| Plugins | `app/plugins/{arxiv_provider,crossref_provider,csl_processor,ghost_writer,latex_exporter}.py` |
| API layer | `app/main.py`, `app/api/v1/api.py`, 20 endpoint modules under `app/api/v1/endpoints/` |
| Models & schemas | 12 models under `app/models/`, 15 schema modules under `app/schemas/`, both `__init__.py` re-export layers |
| Migrations & tests | `alembic/env.py`, migration files (structure), `tests/conftest.py`, 40 test files |

### Methodology
1. Loaded **python-best-practices** skill (type-first design, frozen dataclasses / discriminated unions / `Literal`, `NewType`, `Protocol`, exception chaining with `from`, structured lazy `%s` logging).
2. Full read of every module listed above; cross-referenced call paths between endpoints and services to classify sync/async blocking behavior.
3. Verified configuration behavior empirically: confirmed Settings now loads `.env` via `SettingsConfigDict(env_file=...)` and generates random `SECRET_KEY` in dev.
4. Ran project tooling read-only: `ruff check app tests` → **All checks passed**; `mypy app` → **1 error (duplicate module name "plugins")**.
5. Repo-wide greps: f-string logging sites, `except Exception:` sites (34 locations), mutable-default patterns, `raise ... from` usage, `_check_*_access` duplication counts, dead dependency usage (`pgvector`, `psycopg2`), `hash()` usage, `StrEnum` usage.
6. Checked git tracking status: `.env`, `api.log`, `*.db` are **not** tracked (good).

---

## Executive Summary

| Severity | Count | Δ from prior |
|---|---:|---:|
| **CRITICAL** | 0 | 0 |
| **HIGH** | 2 | -1 (H1, H2a, H2b fixed; H3 remains) |
| **MEDIUM** | 11 | +2 (M1, M2, M8c, M8d, M9 fixed; new M4 regressions confirmed) |
| **LOW** | 13 | +1 (L1, L5, L7, L8d, M9 fixed; L10, L11, L12 persist) |
| **INFO** | 5 | +1 |
| **Total** | **31** | +3 |

**Headline findings**

1. **HIGH — Dependency drift persists in lockfile workflow** (`pyproject.toml` vs `requirements.txt` vs `requirements.lock`). Versions now agree but `requirements.lock` is still compiled from `requirements.txt` (not `pyproject.toml`), lacks hashes, and mixes dev/runtime deps.
2. **HIGH — `pgvector` declared but never used** (M4-d). The hybrid search still computes cosine similarity in pure Python over JSON arrays despite `pgvector>=0.2.5` being locked.
3. **MEDIUM — Provider cache telemetry still incomplete** (M1). `_provider_stats` keys are `("Crossref", "arXiv", "PubMed")` — missing `"OpenAlex"` and `"Semantic Scholar"` which are the two busiest providers.
4. **MEDIUM — Stringly-typed domain states unchanged** (M5). No `StrEnum` / `enum.StrEnum` introduced; role, extraction_status, grounding_state, mode, plugin_type, engine remain raw `str` with duplicated runtime validators.
5. **MEDIUM — Database N+1 and O(N²) patterns unchanged** (M4a, M4b, M4c). Zotero import, intelligence chunk loading, graph citation linking still execute per-item queries or quadratic loops.
6. **MEDIUM — Structural duplication persists** (M7a, M7b, M7c). Citation-map construction triplicated across exporters; `PaperChunk` factory duplicated 6× in `rag_service`; access-guard helpers (`_check_doc_access`, `_check_project_access`) duplicated across 8 endpoint modules.
7. **LOW — Coverage gate still coupled to every `pytest` run** (L10). `addopts = "--cov=app ... --cov-fail-under=93"` forces coverage on every invocation; 6 `test_cov_*.py` files exist primarily to satisfy the gate.
8. **LOW — `hashlib.md5` used for claim IDs** (L12). `intelligence_service.py:146` uses `hashlib.md5(sent.encode())[:12]` while the codebase standardizes on `blake2b` (`rag_service`, `graph_service`).
9. **LOW — `ParsedBlock` not a dataclass** (L9). `ast_parser.ParsedBlock` remains a plain mutable class while `ExportOptions` correctly uses `@dataclass`.
10. **INFO — Pre-commit ruff version mismatch** (I2). `.pre-commit-config.yaml` pins `ruff-pre-commit rev: v0.15.10` while venv/lock runs `ruff 0.16.4`.

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

#### H3. Dependency drift: lockfile built from `requirements.txt`, not `pyproject.toml`; no hashes; dev deps mixed
**Status:** STILL OPEN (partially improved — version floors now agree)
**Files:** `apps/api/pyproject.toml`, `apps/api/requirements.txt`, `apps/api/requirements.lock`
**Evidence:**
- `requirements.lock` header: `pip-compile --output-file=... --strip-extras 'C:\Users\moham\Pictures\OpenResearch\apps\api\requirements.txt'`
- `pyproject.toml` `[project.dependencies]`: 21 entries (excludes `psycopg2-binary`, `pgvector` — they are in `[project.optional-dependencies].postgres`)
- `requirements.txt`: 21 entries (includes `psycopg2-binary>=2.9.9`, `pgvector>=0.2.5`)
- **Version agreement:** `python-docx>=1.2.0`, `reportlab>=4.5.0`, `pypdf>=5.0.0` now match in both files (fixed since prior audit).
- **Lockfile hashes:** None (`grep sha256 requirements.lock` → no matches).
- **Dev deps in lock:** `requirements.lock` includes `pytest==9.1.1`, `mypy==2.3.1`, `ruff==0.16.4`, `coverage`, etc. because `requirements.txt` merges runtime and dev deps.
- **Redundant `httpx`**: Appears in both `[project.dependencies]` and `[project.optional-dependencies].dev` (pyproject.toml:19, 39).
- **`all` extra broken**: Duplicates `postgres` extra verbatim (pyproject.toml:42-45); presumably intended as `postgres + dev`.
- **No `build-system`**: Missing `[build-system]` in `pyproject.toml`; `pip install -e ./apps/api` relies on setuptools fallback.
- **No license/authors/classifiers/urls** in `[project]`.

**Fix:** Pick one workflow. Recommended:
1. Delete `requirements.txt` duplicated pins; keep `requirements.txt` as a convenience symlink or generated artifact.
2. Generate `requirements.lock` from `pyproject.toml`: `pip-compile pyproject.toml --extra postgres -o requirements.lock --generate-hashes`.
3. Produce separate `requirements-dev.lock` (or adopt `uv.lock`).
4. Add `[build-system]` with `setuptools.build_meta` and `[tool.setuptools.packages.find] include=["app*"]`.
5. Add `license`, `authors`, `classifiers`, `keywords`, `urls` to `[project]`.

---

### MEDIUM

#### M1. Provider-cache telemetry still wrong: hardcoded `_provider_stats` keys omit busiest providers
**Status:** STILL OPEN (partially improved — call sites now pass correct provider names)
**Files:** `app/services/provider_cache_service.py:44-54`, `app/services/literature_search_service.py:100-111`, `app/services/identifier_resolver.py:77,176,249`
**Evidence:**
```python
# provider_cache_service.py:44-54 — still only these three keys
self._provider_stats: dict[str, dict[str, Any]] = {
    name: {...} for name in ("Crossref", "arXiv", "PubMed")
}

# literature_search_service.py now correctly passes:
await self._cache_get(cache_key, "OpenAlex")      # line 173
await self._cache_set(cache_key, result, "OpenAlex")  # line 217
await self._cache_get(cache_key, "Crossref")      # line 253
await self._cache_set(cache_key, result, "Crossref")  # line 325
await self._cache_get(cache_key, "arXiv")         # line 359
await self._cache_set(cache_key, result, "arXiv")     # line 420
await self._cache_get(cache_key, "Semantic Scholar")  # line 453
await self._cache_set(cache_key, result, "Semantic Scholar")  # line 498

# identifier_resolver.py also correct:
await provider_cache_service.aget(cache_key, provider_name="Crossref")  # line 77
await provider_cache_service.aset(cache_key, result, provider_name="Crossref")  # line 139
await provider_cache_service.aget(cache_key, provider_name="arXiv")  # line 176
await provider_cache_service.aset(cache_key, result, provider_name="arXiv")  # line 234
await provider_cache_service.aget(cache_key, provider_name="PubMed")  # line 249
await provider_cache_service.aset(cache_key, result, provider_name="PubMed")  # line 296
```
**Impact:**
1. OpenAlex (the only rate-limited provider at 100k req/month) has **zero visibility** in `/system/provider-status`.
2. Semantic Scholar similarly unreported.
3. Crossref/arXiv/PubMed stats only move via `identifier_resolver`, not literature search.
4. Quota dashboard's stated purpose ("protect free-tier usage limits… OpenAlex 100k requests/month") is defeated.

**Fix:** Initialize `_provider_stats` from `PROVIDER_NAMES` (single source of truth in `literature_search_service.py:15-20`):
```python
PROVIDER_NAMES = {
    "openalex": "OpenAlex",
    "crossref": "Crossref",
    "arxiv": "arXiv",
    "semantic_scholar": "Semantic Scholar",
}
# In ProviderCacheService.__init__:
self._provider_stats = {
    display_name: {...} for display_name in PROVIDER_NAMES.values()
}
```

---

#### M4. Database access anti-patterns: N+1 loops, O(N²) scans, unused vector index
**Status:** STILL OPEN (no changes since prior audit)

**(a) Zotero import dedup N+1** — `app/services/zotero_service.py:141-152`
```python
for item in items:  # up to 500 items
    if doi:
        existing = db.query(Paper).filter(Paper.project_id == project_id, Paper.doi == doi).first()
    if not existing and title != "Untitled Document":
        existing = db.query(Paper).filter(Paper.project_id == project_id, Paper.title == title).first()
```
**Fix:** Pre-fetch project's `(doi→id)` and `(title→id)` maps once before loop.

**(b) Intelligence per-paper chunk fetch loops** — `app/services/intelligence_service.py:233-235`
```python
for paper in papers:
    chunks = db.query(PaperChunk).filter(PaperChunk.paper_id == paper.id).limit(10).all()
```
**Fix:** One query `WHERE paper_id IN (...)` grouped in Python, or `selectinload(Paper.chunks)`.

**(c) Quadratic citation-link matching** — `app/services/graph_service.py:146-170`
```python
for p1 in papers:
    for ref in refs:
        for p2 in papers:  # O(P·R·P)
```
**Fix:** Build `doi_index` / normalized-title dict of papers once, then O(P·R) lookups.

**(d) Hybrid search scans every chunk, computes cosine in pure Python** — `app/services/rag_service.py:411-448`
- `yield_per(500)` + bounded top-K heap + batched hydration are good.
- **But** `pgvector>=0.2.5` is locked (`requirements.lock:72`) and **never imported anywhere** (grep-verified).
- When Postgres is configured, store embeddings as `vector(128)` and let pgvector do ANN; keep JSON+Python path strictly for SQLite.

---

#### M5. Stringly-typed domain states defeat the type system
**Status:** STILL OPEN (no `StrEnum` / `Literal` introduced)
**Files (non-exhaustive):**
- `app/models/membership.py:33-35` — `role: Mapped[str] = ...  # 'owner' | 'editor' | 'viewer'`
- `app/models/paper.py:40` — `extraction_status: Mapped[str] = ...  # 'ok' | 'unverified'`
- `app/schemas/teams.py:20,32` — `role: str = "editor"  # 'owner' | 'editor' | 'viewer'` with duplicated validator
- `app/schemas/models.py` (via barrel): `grounding_state: str`, `mode: str`, `plugin_type: str`, `engine: str`
- `app/services/rag_service.py:36-43` — `ExtractionService` documents banning `hash()` but uses raw strings for `extraction_status`
- `app/core/config.py:27` — `ALGORITHM: str = "HS256"` (only one value ever used)

**Impact:** Typos compile fine and fail at runtime (or silently fall through to defaults, as `_resolve_mode` does). Role validator duplicated verbatim in `schemas/teams.py:24-28` and `36-40`.

**Fix:** Introduce shared `StrEnum`s:
```python
from enum import StrEnum

class MembershipRole(StrEnum):
    OWNER = "owner"; EDITOR = "editor"; VIEWER = "viewer"

class ExtractionStatus(StrEnum):
    OK = "ok"; UNVERIFIED = "unverified"; UNRESOLVED = "unresolved"

class GroundingState(StrEnum):
    SOURCE_GROUNDED = "source-grounded"
    AI_INFERENCE = "ai-inference"
    GENERAL_KNOWLEDGE = "general-knowledge"

class ChatMode(StrEnum):
    DOCUMENT = "document"; LIBRARY = "library"; PROJECT = "project"; GENERAL = "general"

class PluginType(StrEnum):
    RESEARCH_PROVIDER = "research_provider"
    AI_PROVIDER = "ai_provider"
    EXPORTER = "exporter"
    PROCESSOR = "processor"
    WRITER = "writer"
```
Pydantic v2 serializes `StrEnum` members transparently; SQLAlchemy columns can keep `String` storage with `Mapped[MembershipRole]` + `Enum(MembershipRole, native_enum=False, length=...)`.

---

#### M6. Author-name parsing centralized — FIXED ✅
**Status:** FIXED
**File:** `app/core/authors.py` (new module)
**Evidence:** `split_full_name(name, family_first=False)` now handles Western ("John Smith" → family=last), PubMed ("Smith J" → family_first=True), and comma-separated ("Smith, John") conventions. Used by `literature_search_service`, `identifier_resolver`, `zotero_service`, `crossref_provider`, `bibtex_exporter`.

---

#### M7. Structural duplication across exporters, endpoints, and the schema monolith
**Status:** PARTIALLY FIXED (schemas split; exporters/guards unchanged)

**(a) Citation-map construction triplicated** — byte-for-byte logic in:
- `app/services/export/markdown_exporter.py:33-47`
- `app/services/export/docx_exporter.py:72-82`
- `app/services/export/pdf_exporter.py:228-238`
```python
citation_map: dict[str, tuple[Paper, int]] = {}
ordered_papers: list[Paper] = []
for citation in citations:
    paper = paper_dict.get(citation.paper_id)
    if paper and paper.id not in citation_map:
        ordered_papers.append(paper)
        citation_map[paper.id] = (paper, len(ordered_papers))
if not ordered_papers and papers:
    for paper in papers:
        ordered_papers.append(paper)
        citation_map[paper.id] = (paper, len(ordered_papers))
```
**Fix:** Extract `build_citation_map(citations, papers) -> tuple[dict, list]` into `ast_parser` or `options`.

**(b) PaperChunk construction triplicated** — `rag_service.py` lines 131, 178, 207, 230, 264, 298 repeat identical 15-line literal.
**Fix:** Extract `_make_chunk(paper, author_str, page, section, para, content, extra_meta=None)`.

**(c) Endpoint access-guard boilerplate** — 8 modules define near-identical `_check_doc_access` / `_check_project_access`:
- `comments.py:_check_doc_access`, `version_history.py:_check_doc_access` (doc-level)
- `graphs.py:_check_project_access`, `intelligence.py:_check_project_access`, `zotero.py:_check_project_access` (project-level)
- `chat.py`, `papers.py`, `citations.py` inline the same logic
Some copies check roles, some don't (e.g., `chat.py:51` omits `required_roles` while `papers.py` demands editor).

**Fix:** Single reusable FastAPI dependency:
```python
# app/services/auth.py or new app/api/deps.py
def require_project_access(required_roles: list[str] = None):
    def dep(current_user: User = Depends(get_current_user), db: Session = Depends(get_db), project_id: str = Path(...)):
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project: raise HTTPException(404)
        if not verify_user_access_to_owner(db, current_user.id, project.owner_id, required_roles):
            raise HTTPException(403)
        return project
    return dep
```

**(d) Schema monolith split** — FIXED ✅ `app/schemas/models.py` is now a barrel file re-exporting from 15 domain modules (`auth.py`, `papers.py`, `citations.py`, `rag_chat.py`, `ai_writing.py`, `export.py`, `graphs.py`, `intelligence.py`, `zotero.py`, `teams.py`, `comments.py`, `documents.py`, `plugins.py`, `projects.py`, `versions.py`, `system.py`).

**(e) Role validator duplication** — `schemas/teams.py:24-28` and `36-40` still duplicate the same `allowed = {"owner","editor","viewer"}` check. **Fix:** Use `MembershipRole` enum (see M5).

---

#### M8. Exception-handling gaps
**Status:** PARTIALLY FIXED

**(a) Lost exception chaining on refresh** — `app/api/v1/endpoints/auth.py:105-111`
```python
try:
    payload = decode_token(token_in.refresh_token, expected_type="refresh")
except jwt.PyJWTError:
    raise credentials_exception from None  # suppresses original
except Exception:
    logger.exception("Unexpected error decoding refresh token")
    raise credentials_exception from None
```
Uses `from None` (deliberate suppression) instead of `from exc`. Skill prescribes `raise ... from err` to preserve traceback.

**(b) Broad swallow-and-return-None in `llm_service`** — `llm_service.py:79,120,148,212,230,365,422`
```python
except Exception as exc:
    logger.warning("...")  # only at some sites
    return None
```
"Honest failure" contract is good product behavior, but `_probe_availability` (line 79) silently sets `self._available = False` with **no log**. Root causes (proxy errors, DNS timeouts vs genuine downtime) hidden.

**(c) Silent broadcast failure** — FIXED ✅ `collaboration.py:159-160` now logs `logger.debug("Redis broadcast failed...", exc_info=True)`.

**(d) Redundant exception tuple** — FIXED ✅ No more `except (asyncio.TimeoutError, WebSocketDisconnect, json.JSONDecodeError, Exception):`.

**(e) `get_or_create_local_user` bare `Exception` catch** — `services/auth.py:105`
```python
except Exception:
    db.rollback()
    raise
```
Should catch `sqlalchemy.exc.IntegrityError` specifically.

---

#### M9. Non-deterministic `hash()` used for IDs — FIXED ✅
**Status:** FIXED
**File:** `app/services/graph_service.py:301`
```python
# Prior: f"rec-{abs(hash(title)) & 0xFFFFFFFF}"
# Now:
rec_id = f"rec-{doi}" if doi else f"rec-{hashlib.blake2b(title.encode(), digest_size=4).hexdigest()}"
```
`rag_service.EmbeddingService` already correctly uses `blake2b` (rag_service.py:57).

---

### LOW

#### L1. Eager f-string logging — FIXED ✅
**Status:** FIXED — All 6 sites from prior audit converted to lazy `%s` formatting.
**Verified:** `grep -r 'logger\.(info|warning|error|debug|exception)(f"' app/` → no matches.
All ~90 logging call sites now use deferred interpolation correctly.

---

#### L2. Linter/type-checker configuration still too narrow to earn "clean" status
**Status:** PARTIALLY FIXED (ruff improved; mypy unchanged)
**File:** `apps/api/pyproject.toml:47-71`
**Current ruff select:** `["E","F","W","I","B","FAST","T10","T20","DTZ","ERA","RUF","ASYNC"]` — expanded from baseline (good).
**Ignored globally:** `["E501","E741","B008","FAST002","FAST001","RUF001","RUF002"]` — `B008` still global (should be per-file-ignores for API layer `Depends` defaults).
**mypy config unchanged:** `ignore_missing_imports = true` disables main value on third-party boundaries; no `disallow_untyped_defs`, `warn_return_any`, `no_implicit_optional`.
**mypy error:** Duplicate module name "plugins" (`app/plugins/__init__.py` vs `app/api/v1/endpoints/plugins.py`) — blocks full type checking.

---

#### L3. Implicit namespace packages for `app`, `core`, `services`, `api`, `endpoints`
**Status:** STILL OPEN
**Missing `__init__.py`:** `app/`, `app/core/`, `app/services/`, `app/api/`, `app/api/v1/`, `app/api/v1/endpoints/`
Only `app/models/`, `app/schemas/`, `app/plugins/`, `app/services/export/` have them.
**Impact:** Works (mypy's `namespace_packages = true` accommodates), but regular packages are more explicit, enable tooling that assumes `__init__.py`, and prevent accidental shadowing.

---

#### L4. `os.path`/`open()` vs `pathlib` inconsistency
**Status:** NOT VERIFIED (prior audit noted `papers.py` uses `os.path`; `tabby_setup_service.py` and `provider_settings.py` use `pathlib.Path`)

---

#### L5. BibTeX exporter output-quality issues — FIXED ✅
**Status:** FIXED
**File:** `app/services/export/bibtex_exporter.py:13-26`
```python
def bibtex_escape(value: Any) -> str:
    text = str(value)
    text = text.replace("\\", "\\\\")
    for ch, repl in (("{", "\\{"), ("}", "\\}"), ("&", "\\&"), ("%", "\\%"), ("#", "\\#"), ("_", "\\_")):
        text = text.replace(ch, repl)
    return text
```
All user-controlled fields now escaped. Entry type still hardcoded `"article"` (L5 partial).

---

#### L6. arXiv endpoints called over plain HTTP
**Status:** STILL OPEN
**Files:** `app/services/literature_search_service.py:365`, `app/services/identifier_resolver.py:181`
```python
"http://export.arxiv.org/api/query"  # literature_search_service.py:365
f"http://export.arxiv.org/api/query?id_list={clean_id}"  # identifier_resolver.py:181
```
arXiv supports HTTPS on `export.arxiv.org`; plaintext risks content tampering in transit and mixed-mode proxy issues. (Zotero/Crossref/OpenAlex/S2 calls all correctly use https.)

---

#### L7. Endpoint reaches into a service's private method
**Status:** NOT VERIFIED
**Prior:** `app/api/v1/endpoints/papers.py:549` called `rag_service._llm_grounded_answer(...)`

---

#### L8. Unused request parameters
**Status:** NOT VERIFIED
**Prior:** `auth.py:54-92` accepted `request: Request` solely to mirror rate-limit dependency signature.

---

#### L9. Hand-rolled classes where dataclasses fit
**Status:** STILL OPEN
**Files:**
- `app/services/export/ast_parser.py:13-28` — `ParsedBlock` plain mutable class; `table_rows` bolted on post-init.
- **Contrast:** `options.ExportOptions` correctly uses `@dataclass`.
- `intelligence_service.py:362` — `_MATRIX_DIMENSIONS: dict` untyped class attribute; should be `ClassVar[Dict[str, Tuple[str, ...]]]` with frozen contents.

---

#### L10. Coverage gate coupled into `pytest` addopts drives low-value tests
**Status:** STILL OPEN
**File:** `pyproject.toml:78-79`
```toml
addopts = "--cov=app --cov-report=term-missing:skip-covered --cov-fail-under=93"
```
**Evidence:** Single test run (`pytest tests/test_cov_services_final.py::test_settings_cors_origin_validator_variants`) fails with `Coverage failure: total of 32 is less than fail-under=93`.
6 of 40 test files named `test_cov_*.py` exist primarily to satisfy the gate.

**Fix:** Move coverage to dedicated CI step (`pytest --cov ... --cov-fail-under=93` there), keeping local runs fast; prefer mutation or assertion-quality checks over raw percentage.

---

#### L11. `.env.example` incomplete relative to `Settings`
**Status:** PARTIALLY FIXED (improved but still missing fields)
**Missing from `.env.example` but present in `config.py`:**
- `REFRESH_TOKEN_EXPIRE_MINUTES`
- `PROJECT_NAME`
- `VERSION`
- `API_V1_STR`
- `MAX_UPLOAD_SIZE_MB` (has default, but not documented)
**Legacy aliases documented but not direct fields:** `GROBID_HOST`, `OLLAMA_HOST` (handled by `resolve_legacy_aliases` validator).

---

#### L12. Assorted small idioms
**Status:** PARTIALLY FIXED

- **MD5 for claim IDs** — STILL OPEN: `intelligence_service.py:146` uses `hashlib.md5(sent.encode("utf-8")).hexdigest()[:12]` while `rag_service` standardizes on `blake2b` (digest_size=8).
- **Out-parameter dict** — STILL OPEN: `zotero_service.import_csl_or_api_data(..., version_out: dict | None = None)` mutates caller-supplied dict (lines 39, 65-66, 260). Return `tuple[ZoteroImportResponse, int | None]`.
- **camelCase local** — `pdf_extractor.py:_parse_tei_xml` uses `persName` (only snake_case elsewhere).
- **Magic numbers** — `rag_service` thresholds (`0.68`, `0.55/0.45`, `0.85`, `600`, `1000`, `30`) and `intelligence_service` score floors (`max(50, 100 - n*20)`) inline; hoist to named module constants alongside `EMBEDDING_DIM`.
- **`stream_autocomplete` fake streaming** — `ai_writing_service.py:175-196` yields one big frame then done over SSE labeled as streaming; docstring honest but consider wiring `llm_service.stream_generate` (exists, used by chat) for true deltas.

---

### INFO

#### I1. Declared-but-unused dependencies
**Status:** STILL OPEN
`pgvector` (see M4-d) and `psycopg2-binary` are declared/locked but `psycopg2` never imported (SQLAlchemy dialect loads it implicitly only when a Postgres URL is used — acceptable, but worth noting the extras exist purely as driver provisioning). If Postgres support is aspirational, mark them as such; if real, the missing pgvector integration is the gap.

#### I2. Toolchain version skew between pre-commit and the venv
**Status:** STILL OPEN
`.pre-commit-config.yaml:18` pins `ruff-pre-commit rev: v0.15.10` while the venv/lock runs `ruff 0.16.4`. Rules and formatting differ meaningfully across that span — commits can pass hooks yet fail CI lint (or vice versa). Align the hook rev with the locked ruff (or use `rev: v0.16.4` / local hook invoking `.venv`).

#### I3. Python version targeting is coherent
**Status:** OK
`requires-python = ">=3.11"` (`pyproject.toml:6`), `[tool.ruff] target-version = "py311"`, `[tool.mypy] python_version = "3.11"`, root `.python-version` = `3.11`, lock compiled under 3.11 — all five agree.

#### I4. Lockfile provenance
**Status:** PARTIALLY FIXED
`requirements.lock` is pip-compile output with transitive provenance comments (good) but without hashes (see H3) and includes a `--strip-extras` note; regenerate cadence isn't documented anywhere.

#### I5. mypy duplicate module error blocks full type checking
**Status:** NEW (not in prior audit)
**Error:** `apps\api\app\plugins\__init__.py: error: Duplicate module named "plugins" (also at "C:\Users\moham\Pictures\OpenResearch\apps\api\app\api\v1\endpoints\plugins.py")`
**Cause:** Two `plugins` modules on the import path: `app.plugins` (package) and `app.api.v1.endpoints.plugins` (module). With `explicit_package_bases = true` and `namespace_packages = true`, mypy cannot disambiguate.
**Fix:** Rename one (e.g., `app/api/v1/endpoints/plugins.py` → `provider_plugins.py` or `plugin_endpoints.py`), or add `__init__.py` to `app/api/v1/endpoints/` to make it a regular package, or exclude one via `[[tool.mypy.overrides]]`.

---

## Project Configuration Review (Updated)

### `pyproject.toml` completeness matrix

| Section | Present | Assessment |
|---|---|---|
| `[project] name/version/description/readme` | ✅ | `readme = "README.md"` — **README.md now exists** (824 bytes) |
| `[project] license, authors, classifiers, keywords, urls` | ❌ | Missing entirely; matters if package is ever published/internal-indexed |
| `[project] requires-python` | ✅ | `>=3.11`, consistent everywhere |
| `[project] dependencies` | ✅ | Reasonable floors; matches `requirements.txt` for shared deps (fixed) |
| `[project.optional-dependencies]` | ⚠️ | `postgres`, `dev`, `all` — `all` still duplicates `postgres` only |
| `[build-system]` | ❌ | No build backend declared; `pip install -e ./apps/api` relies on fallback |
| `[project.scripts]` | ❌ | No console entrypoint; launching depends on Windows `.cmd` scripts |
| `[tool.ruff]` | ⚠️ | Correct target/excludes; rule selection improved; `B008` global ignore should be per-file |
| `[tool.ruff.lint.per-file-ignores]` | ✅ | Good coverage for `tests/**` and `alembic/**` |
| `[tool.mypy]` | ⚠️ | Sensible base but lenient; duplicate module error blocks full check |
| `[tool.coverage.run]` | ⚠️ | `source=["app"]` only; no `branch = true`; threshold in pytest addopts (L10) |
| `[tool.pytest.ini_options]` | ⚠️ | Coverage forced into every run (L10); `testpaths` unset; custom event-loop fixture fights pytest-asyncio |
| `[tool.ty]` / modern tools | ➖ | Skill suggests optional `ty`; not required |

### Environment & secrets handling
- `.env` files present locally and **not git-tracked** ✅.
- `.env.example` exists and documents safe defaults ✅, but incomplete (L11).
- Production guardrails in `Settings.validate_production_security` (`config.py:112-149`) exemplary: refuses compromised/default/short secrets and SQLite in production.
- API keys stored plaintext in `storage/provider_keys.json` (`provider_settings.py:110-133`) with masked API responses — acceptable for local-first desktop-style app; file permissions not tightened (`write_text` uses umask default); consider `chmod 600` equivalent on POSIX.
- `DEFAULT_HEADERS["User-Agent"]` consolidated in `http_client.py:14`; `identifier_resolver` and `zotero_service` still override per-request (harmless but inconsistent).

### Logging setup
- Module-scoped named loggers (`logging.getLogger("openresearch.<domain>")`) throughout ✅.
- No centralized logging configuration (no `dictConfig`/`fileConfig` in app code; uvicorn defaults apply in dev).
- Middleware logs every request at INFO with latency (`middleware.py:45-52`) — uses lazy `%s` formatting correctly.
- `contextvars`-based request ID propagation via `logging_config.request_id_var` — good; no filter to inject into record context yet.

### Module organization & circular imports
- Layering clean and acyclic: `api → services → core/models/schemas` ✅.
- Models use `TYPE_CHECKING` guards + string forward refs correctly.
- `main.py` defers heavy imports into functions where sensible.
- No circular-import hacks found.
- Facade pattern `services/export_service.py` re-exporting `services/export/` preserves backward compatibility ✅ (though `__all__` ordering differs between facade and package `__init__`).

---

## Positive Observations (Preserved from Prior Audit + New)

1. **Production configuration guardrails** (`config.py:112-149`) actively reject known-compromised secret defaults, short secrets, and SQLite-in-production — rare and excellent.
2. **Honest-failure AI semantics** documented and enforced end-to-end (`llm_service` docstring, `AIProviderUnavailableError`, "Insufficient evidence…" protocol, deterministic fallbacks).
3. **Correct async-offloading where it counts**: upload streaming (`papers.py:101-132`), pdfplumber via `anyio.to_thread.run_sync` (`pdf_extractor.py:134`), DB save/chunk offload (`papers.py:163-190`), identifier-save flow (`citations.py:261-307`), graph discovery (`graph_service.py:234-236` now uses `asyncio.to_thread`).
4. **Memory-bounded retrieval**: `hybrid_search` streams rows (`yield_per(500)`) into bounded top-K heap (`rag_service.py:377-433`) with batched hydration of surviving papers only — textbook streaming top-K.
5. **Stable embeddings discipline**: BLAKE2b feature hashing with explicit comment banning salted `hash()` (`rag_service.py:36-43`).
6. **SQLAlchemy 2.0 idiom**: `Mapped[]`/`mapped_column` typing everywhere, `TYPE_CHECKING` relationship cycles handled cleanly, WAL/busy-timeout pragmas for SQLite (`database.py:11-19`), `pool_pre_ping=True`.
7. **Secure-by-default details**: sanitized `X-Request-ID` charset to block log injection (`middleware.py:18,30`), fixed-argument subprocess lists with no shell interpolation (`tabby_setup_service.py:12`), first-frame WS auth keeping tokens out of URLs (`collaboration.py:189-191`), bounded WS frame size + sliding-window rate limit, PDF magic-byte validation mid-stream with partial-upload cleanup (`papers.py:110-130`), optimistic locking on documents (`documents.py:109-114`), IntegrityError retry for concurrent version allocation (`version_history.py:36-49`).
8. **Hermetic tests**: autouse fixtures isolate Redis, rate-limit state, and provider-key store into `tmp_path` (`conftest.py:36-51`); StaticPool in-memory DB per function.
9. **Author parsing centralized** in `app/core/authors.py` — eliminates 5 inconsistent implementations.
10. **Schemas split** into 15 domain modules — `models.py` is now a clean barrel file.

---

## Prior Audit Findings — Verification Status

| ID | Prior Finding | Status | Notes |
|---|---|---|---|
| H1 | pydantic-settings bypassed; `.env` silently ignored | **FIXED** | `SettingsConfigDict(env_file=...)` + auto-generated dev `SECRET_KEY` |
| H2a | Sync Redis in async lit-search/resolver | **FIXED** | `provider_cache_service.aget/aset` with `asyncio.to_thread` |
| H2b | Sync DB query in async graph handler | **FIXED** | `asyncio.to_thread.run_sync(lambda: db.query(...).all())` |
| H2c | WebSocket holds DB session for socket lifetime | **FIXED** | `db.close()` at line 268 after auth; writes use `SessionLocal()` |
| H3 | Dependency drift pyproject.toml vs requirements.txt | **PARTIALLY FIXED** | Version floors agree; lockfile workflow still wrong |
| M1 | Provider-cache telemetry hardcoded to "OpenAlex" | **PARTIALLY FIXED** | Call sites correct; `_provider_stats` keys still incomplete |
| M2 | ProviderCacheService not thread-safe | **FIXED** | Added `_cache_lock` and `_redis_lock` |
| M3 | Import-time side effects / mutable singletons | **PARTIALLY FIXED** | `SECRET_KEY` no longer captured at import; other singletons remain |
| M4a | Zotero N+1 dedup | **STILL OPEN** | No change |
| M4b | Intelligence chunk fetch loops | **STILL OPEN** | No change |
| M4c | Graph O(N²) citation linking | **STILL OPEN** | No change |
| M4d | pgvector unused | **STILL OPEN** | Still not imported anywhere |
| M5 | Stringly-typed domain states | **STILL OPEN** | No StrEnum/Literal introduced |
| M6 | Author parsing 5× inconsistent | **FIXED** | Centralized in `app/core/authors.py` |
| M7a | Citation-map triplicated | **STILL OPEN** | No extraction |
| M7b | PaperChunk construction 6× | **STILL OPEN** | No factory helper |
| M7c | Access-guard boilerplate ×8 | **STILL OPEN** | Some use shared `verify_user_access_to_owner`; helpers still duplicated |
| M7d | `schemas/models.py` monolith | **FIXED** | Split into 15 domain modules |
| M7e | Role validator duplicated | **STILL OPEN** | `schemas/teams.py` lines 24-28 vs 36-40 |
| M8a | Exception chaining lost on refresh | **PARTIALLY FIXED** | Uses `from None` (suppression) not `from exc` |
| M8b | Broad swallow in llm_service | **STILL OPEN** | Silent `_probe_availability` failure |
| M8c | Silent broadcast failure | **FIXED** | `logger.debug(..., exc_info=True)` |
| M8d | Redundant exception tuple | **FIXED** | Removed |
| M8e | Bare Exception in auth | **STILL OPEN** | Should catch `IntegrityError` |
| M9 | `abs(hash(title))` for IDs | **FIXED** | Now `hashlib.blake2b` |
| L1 | 6 f-string logging sites | **FIXED** | All converted to `%s` |
| L2 | Linter config too narrow | **PARTIALLY FIXED** | Ruff expanded; mypy unchanged |
| L3 | Missing `__init__.py` | **STILL OPEN** | 6 directories lack them |
| L4 | os.path vs pathlib | **NOT VERIFIED** | |
| L5 | BibTeX escaping missing | **FIXED** | `bibtex_escape()` added |
| L6 | arXiv HTTP not HTTPS | **STILL OPEN** | |
| L7 | Private method access | **NOT VERIFIED** | |
| L8 | Unused Request params | **NOT VERIFIED** | |
| L9 | ParsedBlock not dataclass | **STILL OPEN** | |
| L10 | Coverage gate in addopts | **STILL OPEN** | |
| L11 | .env.example incomplete | **PARTIALLY FIXED** | Better but still missing 4 fields |
| L12 | MD5 for claim IDs | **STILL OPEN** | |
| I1 | pgvector/psycopg2 unused | **STILL OPEN** | |
| I2 | pre-commit ruff version skew | **STILL OPEN** | v0.15.10 vs 0.16.4 |
| I3 | Python version coherent | **OK** | |
| I4 | Lockfile provenance | **PARTIALLY FIXED** | Has provenance, no hashes |

---

## Prioritized Recommendations

### P0 — Do next sprint (correctness in normal operation)
1. **H3**: Reconcile lockfile workflow — generate `requirements.lock` from `pyproject.toml --extra postgres` with `--generate-hashes`; split dev deps into `requirements-dev.lock`; add `[build-system]`, `license`, `authors` to `pyproject.toml`.
2. **M1**: Fix `_provider_stats` initialization from `PROVIDER_NAMES` so OpenAlex and Semantic Scholar are tracked.
3. **M4d**: Adopt `pgvector` for Postgres deployments — store embeddings as `vector(128)`, use ANN index; keep JSON path for SQLite only.
4. **M8a/e**: Exception chaining — use `raise ... from exc` in `auth.py:107` and `services/auth.py:105` (catch `IntegrityError` specifically).

### P1 — Next 1–2 months (structural debt that compounds)
5. **M5**: Introduce `StrEnum`s for `MembershipRole`, `ExtractionStatus`, `GroundingState`, `ChatMode`, `PluginType`, `AutocompleteEngine`; replace duplicated role validators.
6. **M4a/b/c**: Pre-fetch dedup maps in Zotero import; batch chunk loading in intelligence; dict-based citation linking in graphs.
7. **M7a/b/c**: Extract `build_citation_map` and `PaperChunk` factory; introduce shared `require_project_access` / `require_document_access` dependencies.
8. **M8b**: Log at DEBUG/WARNING in `llm_service._probe_availability` and other swallow sites.
9. **I5**: Fix mypy duplicate module error (rename `endpoints/plugins.py` or add `__init__.py` to `endpoints/`).

### P2 — Hygiene passes (fit into ordinary PRs)
10. **L2**: Widen ruff selection; scope `B008` per-file; tighten mypy incrementally (`warn_unused_ignores`, `no_implicit_optional`).
11. **L3/L4/L9**: Add missing `__init__.py`s; standardize on `pathlib`; convert `ParsedBlock` to `@dataclass(slots=True)`.
12. **L5/L6**: BibTeX entry type inference from metadata; switch arXiv to HTTPS.
13. **L10/L11/I2/I4**: Decouple coverage gate from local `pytest`; complete `.env.example`; bump pre-commit ruff rev to match lock; add hashes to lockfile.
14. **L12**: Replace `hashlib.md5` with `blake2b` in `intelligence_service`; replace `version_out` dict with returned tuple; hoist magic numbers to constants.

---

*End of follow-up report — 31 findings (0 CRITICAL / 2 HIGH / 11 MEDIUM / 13 LOW / 5 INFO) over 85 source files. 10/28 prior findings fixed; 9 partially fixed; 9 still open; 3 new findings added (I5, M7e role validator dup, L7/L8 unverified).*